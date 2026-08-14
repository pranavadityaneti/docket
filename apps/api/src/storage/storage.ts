import { Injectable, Module } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { S3StorageDriver } from "./s3";

/**
 * Where documents actually live.
 *
 * Two drivers behind one interface: local disk for development, S3 for
 * production (Change 3b). The interface is deliberately shaped around
 * PRESIGNED uploads even though the local driver cannot presign anything -
 * the client asks for an "upload target" and PUTs the bytes there. For S3
 * that target is a presigned URL and the file never touches our server; for
 * local it is a route on this API. Designing it any other way would mean
 * rewriting the client the day we move to S3.
 *
 * `put()` exists alongside for server-side ingestion: when a document arrives
 * by WhatsApp or email there is no browser to hand a URL to, so the API
 * fetches the media itself and writes it directly.
 */

/** Where the client should send the bytes. */
export type UploadTarget = {
  /** Absolute or API-relative URL to PUT to. */
  url: string;
  method: "PUT" | "POST";
  /** Headers the client must send verbatim (S3 signs some of these). */
  headers: Record<string, string>;
  /** Seconds until `url` stops working. */
  expiresIn: number;
};

export type StoredObject = {
  sizeBytes: number;
  /** SHA-256, hex. Used to spot the same file arriving on two channels. */
  checksum: string;
};

export interface StorageDriver {
  /** A target the client can upload to directly. */
  requestUpload(key: string, contentType?: string): Promise<UploadTarget>;
  /** Server-side write (WhatsApp/email ingestion). */
  put(key: string, body: Buffer, contentType?: string): Promise<StoredObject>;
  /** Size + checksum of a stored object, or null if it isn't there. */
  head(key: string): Promise<StoredObject | null>;
  /** Read it back - for download and, later, for OCR. */
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/**
 * Object key for a document.
 *
 * Tenant-first so that per-tenant IAM enforcement is POSSIBLE later: a policy
 * can restrict a principal to `tenants/<id>/*`. Today there is a single
 * application principal, so this buys auditability and a future boundary - it
 * is not a second boundary yet. Postgres RLS is the boundary.
 *
 * The user's filename is deliberately NOT in the key. It is untrusted input
 * (path traversal, unicode, absurd length), it is already stored as a column,
 * and a key that changes when someone renames a file is a key that rots.
 */
export function documentKey(tenantId: string, caseId: string, documentId: string): string {
  return `tenants/${tenantId}/cases/${caseId}/${documentId}`;
}

/**
 * Key for an inbound document that matched no case. Deliberately NOT under any
 * case's prefix - it does not belong to one yet, and assignment later points a
 * documents row at this same key rather than copying bytes.
 */
export function unmatchedKey(tenantId: string, unmatchedId: string): string {
  return `tenants/${tenantId}/unmatched/${unmatchedId}`;
}

/** Workspace brand mark — one object per tenant, replaced in place. */
export function brandingLogoKey(tenantId: string): string {
  return `tenants/${tenantId}/branding/logo`;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Local-disk driver - development only.
 *
 * Uploads are not presigned (nothing to sign against a filesystem), so the
 * target points at this API's own upload route, carrying a short-lived token
 * that names the key. Without that token the route would be an open write
 * primitive: anyone could PUT to any key, including another tenant's.
 */
@Injectable()
export class LocalStorageDriver implements StorageDriver {
  private readonly root = env.storageLocalRoot;
  /** token -> { key, contentType, expiresAt }. In-memory: dev only, dies with the process. */
  private readonly tickets = new Map<
    string,
    { key: string; contentType?: string; expiresAt: number }
  >();

  private filePath(key: string): string {
    // The key is built by documentKey() from UUIDs, never from user input, but
    // resolve and re-check anyway: a traversal here writes outside the store.
    const full = path.resolve(this.root, key);
    const rootResolved = path.resolve(this.root);
    if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
      throw new Error("Refusing to write outside the storage root");
    }
    return full;
  }

  async requestUpload(key: string, contentType?: string): Promise<UploadTarget> {
    const token = randomBytes(24).toString("base64url");
    const expiresIn = 900; // 15 minutes, same order as an S3 presign
    this.tickets.set(token, { key, contentType, expiresAt: Date.now() + expiresIn * 1000 });
    return {
      url: `${env.publicApiUrl}/uploads/${token}`,
      method: "PUT",
      headers: contentType ? { "content-type": contentType } : {},
      expiresIn,
    };
  }

  /** Redeem an upload ticket. Single-use: a token cannot overwrite twice. */
  redeemTicket(token: string): { key: string; contentType?: string } | null {
    const t = this.tickets.get(token);
    if (!t) return null;
    this.tickets.delete(token);
    if (Date.now() > t.expiresAt) return null;
    return { key: t.key, contentType: t.contentType };
  }

  async put(key: string, body: Buffer): Promise<StoredObject> {
    const full = this.filePath(key);
    await mkdir(path.dirname(full), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(full);
      out.on("error", reject);
      out.on("finish", () => resolve());
      out.end(body);
    });
    return { sizeBytes: body.byteLength, checksum: sha256(body) };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const s = await stat(this.filePath(key));
      if (!s.isFile()) return null;
      // Checksum requires a read; files here are bounded by the upload limit.
      const buf = await this.get(key);
      return { sizeBytes: s.size, checksum: sha256(buf) };
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(this.filePath(key));
      rs.on("data", (c) => chunks.push(c as Buffer));
      rs.on("error", reject);
      rs.on("end", () => resolve());
    });
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await rm(this.filePath(key), { force: true });
  }
}

/** Injection token for whichever driver is configured. */
export const STORAGE = "STORAGE_DRIVER";

/**
 * Both drivers are constructed, and env picks which one answers the token.
 *
 * LocalStorageDriver stays registered even in production because the upload
 * route depends on it directly - but that route is only ever reached when the
 * local driver is also the one handing out targets, and env refuses to boot
 * production on the local driver at all.
 */
@Module({
  providers: [
    LocalStorageDriver,
    S3StorageDriver,
    {
      provide: STORAGE,
      inject: [LocalStorageDriver, S3StorageDriver],
      useFactory: (local: LocalStorageDriver, s3: S3StorageDriver) =>
        env.storageDriver === "s3" ? s3 : local,
    },
  ],
  exports: [STORAGE, LocalStorageDriver],
})
export class StorageModule { }
