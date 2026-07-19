import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";
import type { StorageDriver, StoredObject, UploadTarget } from "./storage";

/**
 * S3 driver — production.
 *
 * Uploads are presigned, so a borrower's twelve bank statements go straight
 * from the browser to S3 and never occupy memory or bandwidth on a t3.micro.
 * The API only ever sees the metadata.
 *
 * Credentials come from the EB instance role, never from environment
 * variables: the default provider chain picks up the instance profile
 * automatically, and there is nothing to leak or rotate.
 */
@Injectable()
export class S3StorageDriver implements StorageDriver {
  private readonly s3 = new S3Client({ region: env.awsRegion });
  private readonly bucket = env.s3Bucket;
  private readonly kmsKeyId = env.s3KmsKeyId;

  /**
   * Encryption headers must be part of BOTH the signature and the request the
   * client actually sends. The bucket policy denies any PUT that does not
   * declare aws:kms, so a client that drops these headers is refused rather
   * than quietly writing something weaker — but that also means an unsigned
   * mismatch fails with an opaque SignatureDoesNotMatch. They travel together.
   */
  private encryptionHeaders(): Record<string, string> {
    const h: Record<string, string> = { "x-amz-server-side-encryption": "aws:kms" };
    if (this.kmsKeyId) h["x-amz-server-side-encryption-aws-kms-key-id"] = this.kmsKeyId;
    return h;
  }

  async requestUpload(key: string, contentType?: string): Promise<UploadTarget> {
    const expiresIn = 900; // 15 minutes — long enough for a slow mobile upload
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ServerSideEncryption: "aws:kms",
        ...(this.kmsKeyId ? { SSEKMSKeyId: this.kmsKeyId } : {}),
      }),
      { expiresIn },
    );
    return {
      url,
      method: "PUT",
      headers: {
        ...(contentType ? { "content-type": contentType } : {}),
        ...this.encryptionHeaders(),
      },
      expiresIn,
    };
  }

  /** Server-side write — WhatsApp/email ingestion, where there is no browser. */
  async put(key: string, body: Buffer, contentType?: string): Promise<StoredObject> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: "aws:kms",
        ...(this.kmsKeyId ? { SSEKMSKeyId: this.kmsKeyId } : {}),
      }),
    );
    return { sizeBytes: body.byteLength, checksum: sha256(body) };
  }

  /**
   * Size and checksum of what is actually stored.
   *
   * HeadObject alone gives size but not a SHA-256 we can trust — S3's ETag is
   * an MD5 only for single-part, unencrypted uploads, and is neither for a
   * KMS-encrypted or multipart object. So the object is read back and hashed.
   * That costs a GET per confirmation, which is the honest price of the API
   * knowing what it holds rather than believing the client.
   */
  async head(key: string): Promise<StoredObject | null> {
    try {
      const meta = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = await this.get(key);
      return { sizeBytes: meta.ContentLength ?? body.byteLength, checksum: sha256(body) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * A missing object and a forbidden one must be told apart: "no file was
 * uploaded" is a 400 the caller can act on, while a permissions failure is a
 * 500 we need to see. S3 reports a missing key as 404/NotFound — but when the
 * caller lacks ListBucket it reports 403 instead, which is why the instance
 * role is granted ListBucket on the bucket.
 */
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}
