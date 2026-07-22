import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  cases,
  channels,
  contacts,
  documents,
  normaliseCaseReference,
  openSecret,
} from "@docket/db";
import { DbService } from "../db/db";
import { STORAGE, type StorageDriver, documentKey } from "../storage/storage";
import { env } from "../config/env";

/**
 * WhatsApp Cloud API intake — the push counterpart to the email poller.
 *
 * A subject sends a document to the tenant's WhatsApp number and it appears on
 * the right case, with no portal. Where email is pulled on a timer, WhatsApp is
 * pushed: Meta calls this webhook. Two endpoints, both unauthenticated by JWT
 * because Meta cannot present one — security is instead:
 *   - GET  : the verify-token handshake (only Meta, holding our token, passes);
 *   - POST : an HMAC-SHA256 signature over the raw body, keyed by the tenant's
 *            own Meta app secret (a forged body cannot be signed).
 *
 * Matching mirrors email exactly — conservative, never a guess:
 *   1. a DKT-XXXXXX reference in the message caption/text wins;
 *   2. the sender's phone number mapped to their most recent case;
 *   3. otherwise the message is left for a human.
 */

/* ---- Meta webhook payload (only the fields we read) ---- */

interface WaMediaPart {
  id: string;
  mime_type?: string;
  filename?: string;
  caption?: string;
  sha256?: string;
}

interface WaMessage {
  from: string;
  id: string;
  type: string;
  text?: { body?: string };
  image?: WaMediaPart;
  document?: WaMediaPart;
  video?: WaMediaPart;
  audio?: WaMediaPart;
}

interface WaChangeValue {
  metadata?: { phone_number_id?: string };
  messages?: WaMessage[];
}

interface WaWebhookBody {
  object?: string;
  entry?: Array<{ changes?: Array<{ value?: WaChangeValue }> }>;
}

type ChannelRow = typeof channels.$inferSelect;
type Tx = Parameters<Parameters<DbService["withTenant"]>[1]>[0];

/** Decrypted WhatsApp credential, as stored (JSON) in channels.secretCiphertext. */
interface WhatsappSecret {
  accessToken: string;
  appSecret: string;
}

@Injectable()
export class WhatsappService {
  private readonly log = new Logger(WhatsappService.name);

  constructor(
    private readonly db: DbService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  /**
   * Handle one webhook delivery. Never throws — Meta must always get its 200, or
   * it retries and eventually disables the webhook. Every failure is logged and,
   * where it belongs to a known channel, recorded on that channel's lastError.
   */
  async handleWebhook(
    body: WaWebhookBody,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    const changes = (body.entry ?? [])
      .flatMap((e) => e.changes ?? [])
      .map((c) => c.value)
      .filter((v): v is WaChangeValue => !!v && !!v.metadata?.phone_number_id);

    if (changes.length === 0) return; // status callbacks etc. — nothing to ingest

    // Resolve each distinct phone number to its channel once.
    const byPhoneId = new Map<string, ChannelRow>();
    for (const phoneId of new Set(changes.map((c) => c.metadata!.phone_number_id!))) {
      const channel = await this.findChannel(phoneId);
      if (channel) byPhoneId.set(phoneId, channel);
      else this.log.warn(`WhatsApp: no channel for phone_number_id ${phoneId} — ignored`);
    }
    if (byPhoneId.size === 0) return;

    // Signature is computed by the sending app over the whole raw body. Numbers
    // in one delivery belong to one Meta app, so any resolved channel's app
    // secret verifies it. Reject the entire delivery if it does not check out —
    // an unsigned or wrongly-signed body is not acted on at all.
    const firstChannel = byPhoneId.values().next().value as ChannelRow;
    let firstSecret: WhatsappSecret;
    try {
      firstSecret = this.decrypt(firstChannel);
    } catch {
      await this.recordError(firstChannel, "Stored credential could not be decrypted");
      return;
    }
    if (!this.signatureValid(rawBody, signature, firstSecret.appSecret)) {
      this.log.error("WhatsApp: signature verification failed — delivery dropped");
      // The most likely cause is a mistyped app secret at channel setup — and
      // without this, that mistake is invisible outside server logs while every
      // inbound document silently vanishes. Surface it where staff look.
      for (const channel of byPhoneId.values()) {
        await this.recordError(
          channel,
          "Webhook signature verification failed — the channel's app secret is likely wrong",
        );
      }
      return;
    }

    for (const change of changes) {
      const channel = byPhoneId.get(change.metadata!.phone_number_id!);
      if (!channel) continue;
      let secret: WhatsappSecret;
      try {
        secret = this.decrypt(channel);
      } catch {
        await this.recordError(channel, "Stored credential could not be decrypted");
        continue;
      }
      for (const message of change.messages ?? []) {
        try {
          await this.ingestMessage(channel, secret, message);
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          this.log.error(`WhatsApp: message ${message.id} failed: ${detail}`);
          await this.recordError(channel, `Message ${message.id}: ${detail}`);
        }
      }
    }
  }

  /** Store one inbound message's media on the matched case. */
  private async ingestMessage(
    channel: ChannelRow,
    secret: WhatsappSecret,
    message: WaMessage,
  ): Promise<void> {
    const media = mediaPart(message);
    if (!media) return; // text-only or unsupported type — nothing to store

    const caption = media.caption ?? message.text?.body ?? "";
    const buffer = await this.downloadMedia(media.id, secret.accessToken);

    if (buffer.length === 0) return;
    if (buffer.length > env.maxUploadBytes) {
      this.log.warn(`WhatsApp: ${media.id} exceeds size limit — skipped`);
      return;
    }

    const checksum = sha256(buffer);
    const fileName = media.filename ?? fallbackName(message, media);
    const mimeType = media.mime_type ?? null;

    await this.db.withTenant(channel.tenantId, async (tx) => {
      const caseId = await this.matchCase(tx, caption, message.from);
      if (!caseId) {
        // Never guess. A misfiled KYC document is worse than an unfiled one.
        this.log.warn(
          `WhatsApp: message ${message.id} from ${message.from} matched no case — skipped`,
        );
        return;
      }

      // Idempotency: Meta re-delivers on any missed 200. The same file already on
      // this case (same SHA-256, not deleted) means we have seen this message —
      // skip rather than create a duplicate document.
      const [dupe] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.caseId, caseId),
            eq(documents.checksum, checksum),
            sql`${documents.deletedAt} is null`,
          ),
        )
        .limit(1);
      if (dupe) {
        this.log.log(`WhatsApp: message ${message.id} already on case ${caseId} — skipped`);
        return;
      }

      const [doc] = await tx
        .insert(documents)
        .values({
          tenantId: channel.tenantId,
          caseId,
          requirementId: null, // a human (later the AI) places it on the checklist
          fileName,
          mimeType,
          status: "received",
          sourceChannel: "whatsapp",
          sourceIdentifier: message.from,
        })
        .returning();

      const key = documentKey(channel.tenantId, caseId, doc.id);
      const stored = await this.storage.put(key, buffer, mimeType ?? undefined);
      await tx
        .update(documents)
        .set({ storageKey: key, sizeBytes: stored.sizeBytes, checksum: stored.checksum })
        .where(eq(documents.id, doc.id));

      this.log.log(`WhatsApp: imported ${fileName} onto case ${caseId}`);
    });

    await this.db.admin
      .update(channels)
      .set({ lastPolledAt: new Date(), lastError: null })
      .where(eq(channels.id, channel.id))
      .catch(() => {});
  }

  /**
   * Which case does this message belong to? Runs inside withTenant, so every
   * lookup is tenant-scoped. Returns null rather than guessing.
   */
  private async matchCase(tx: Tx, caption: string, from: string): Promise<string | null> {
    // 1. explicit reference in the caption/text — the strongest signal.
    for (const token of caption.match(/DKT[-\s]?[0-9A-Za-z]{6}/gi) ?? []) {
      const ref = normaliseCaseReference(token.replace(/\s/g, ""));
      if (!ref) continue;
      const [c] = await tx
        .select({ id: cases.id })
        .from(cases)
        .where(eq(cases.reference, ref))
        .limit(1);
      if (c) return c.id;
    }

    // 2. the sender's phone -> their most recent case. Matched on the last 10
    // digits so a leading country code (Meta sends "9198…", a contact may be
    // stored "+91 98…" or "098…") does not cause a miss. Done in SQL to stay
    // correct as the tenant's case count grows rather than scanning in memory.
    const last10 = from.replace(/\D/g, "").slice(-10);
    if (last10.length >= 7) {
      const [c] = await tx
        .select({ id: cases.id })
        .from(cases)
        .innerJoin(contacts, eq(cases.contactId, contacts.id))
        .where(
          and(
            isNotNull(contacts.phone),
            sql`right(regexp_replace(${contacts.phone}, '\\D', '', 'g'), 10) = ${last10}`,
          ),
        )
        .orderBy(desc(cases.createdAt))
        .limit(1);
      if (c) return c.id;
    }

    return null;
  }

  /** Two-step media fetch: metadata URL, then the authenticated binary. */
  private async downloadMedia(mediaId: string, accessToken: string): Promise<Buffer> {
    const base = `https://graph.facebook.com/${env.graphApiVersion}`;
    const metaRes = await fetch(`${base}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!metaRes.ok) {
      throw new Error(`media metadata fetch ${metaRes.status} (token may be invalid/expired)`);
    }
    const meta = (await metaRes.json()) as { url?: string };
    if (!meta.url) throw new Error("media metadata had no url");

    const binRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!binRes.ok) throw new Error(`media download ${binRes.status}`);
    return Buffer.from(await binRes.arrayBuffer());
  }

  private decrypt(channel: ChannelRow): WhatsappSecret {
    if (!env.channelSecretKey) throw new Error("CHANNEL_SECRET_KEY is not configured");
    if (!channel.secretCiphertext) throw new Error("channel has no stored credential");
    const parsed = JSON.parse(openSecret(channel.secretCiphertext, env.channelSecretKey)) as
      | Partial<WhatsappSecret>
      | undefined;
    if (!parsed?.accessToken || !parsed?.appSecret) {
      throw new Error("stored credential is missing accessToken/appSecret");
    }
    return { accessToken: parsed.accessToken, appSecret: parsed.appSecret };
  }

  private signatureValid(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    appSecret: string,
  ): boolean {
    if (!rawBody || !signature?.startsWith("sha256=")) return false;
    const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private findChannel(phoneNumberId: string): Promise<ChannelRow | undefined> {
    return this.db.admin
      .select()
      .from(channels)
      .where(
        and(
          eq(channels.kind, "whatsapp"),
          eq(channels.enabled, true),
          sql`${channels.config}->>'phoneNumberId' = ${phoneNumberId}`,
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
  }

  private async recordError(channel: ChannelRow, error: string): Promise<void> {
    await this.db.admin
      .update(channels)
      .set({ lastPolledAt: new Date(), lastError: error })
      .where(eq(channels.id, channel.id))
      .catch(() => {});
  }
}

@Controller("webhooks/whatsapp")
export class WhatsappWebhookController {
  private readonly log = new Logger(WhatsappWebhookController.name);

  constructor(private readonly whatsapp: WhatsappService) {}

  /**
   * Meta's one-time verification handshake. It echoes hub.challenge iff the
   * caller presents our verify token. Global token (see env.whatsappVerifyToken):
   * this runs when the webhook URL is configured, before any channel exists.
   */
  @Get()
  verify(@Query() q: Record<string, string>): string {
    const mode = q["hub.mode"];
    const token = q["hub.verify_token"];
    const challenge = q["hub.challenge"] ?? "";
    if (mode === "subscribe" && env.whatsappVerifyToken && token === env.whatsappVerifyToken) {
      this.log.log("WhatsApp webhook verified");
      return challenge;
    }
    throw new ForbiddenException("verification failed");
  }

  /**
   * Inbound messages. Always 200 (even on internal error) so Meta does not retry
   * a poison message forever or disable the webhook; the work is best-effort and
   * every failure is logged. Signature verification happens inside the service.
   */
  @Post()
  @HttpCode(200)
  async receive(
    @Body() body: WaWebhookBody,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers("x-hub-signature-256") signature?: string,
  ): Promise<string> {
    try {
      await this.whatsapp.handleWebhook(body, req.rawBody, signature);
    } catch (e) {
      this.log.error(`WhatsApp webhook error: ${e instanceof Error ? e.message : String(e)}`);
    }
    return "EVENT_RECEIVED";
  }
}

/** The media part of a supported message, or null for text/unsupported. */
function mediaPart(message: WaMessage): WaMediaPart | null {
  return message.document ?? message.image ?? message.video ?? message.audio ?? null;
}

/** A filename when WhatsApp gives none (images/video/audio carry no filename). */
function fallbackName(message: WaMessage, media: WaMediaPart): string {
  const ext = media.mime_type?.split("/")[1]?.split(";")[0];
  return `${message.type}-${message.id}${ext ? `.${ext}` : ""}`;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
