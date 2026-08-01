import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  cases,
  channels,
  contacts,
  conversationMessages,
  documents,
  normaliseCaseReference,
  openSecret,
  unmatchedDocuments,
} from "@docket/db";
import { DbService } from "../db/db";
import { ClassifyApplier } from "../classify/classify";
import { STORAGE, type StorageDriver, documentKey, unmatchedKey } from "../storage/storage";
import { env } from "../config/env";

export type PollResult = {
  fetched: number;
  imported: number;
  unmatched: number;
  error?: string;
};

type ChannelRow = typeof channels.$inferSelect;

/** Ceiling on stored message text — a pasted contract is a document, not a chat line. */
const MAX_CONVERSATION_CHARS = 8_000;

/**
 * Pulls a tenant's mailbox and turns inbound attachments into case documents.
 *
 * This is the product's premise made real: a subject emails their documents to
 * the tenant's own address and they appear on the right case, with no portal to
 * log into. The dashboard is for staff; the subject only ever uses email (and,
 * later, WhatsApp).
 *
 * Matching is deliberately conservative — a wrong match files a borrower's bank
 * statement onto someone else's loan, which is worse than not filing it. So:
 *   1. an explicit DKT-XXXXXX reference in the subject wins (we put it there);
 *   2. failing that, the sender's email mapped to their most recent case;
 *   3. failing that, the message is left for a human — never guessed.
 */
@Injectable()
export class EmailPollerService {
  private readonly log = new Logger(EmailPollerService.name);

  constructor(
    private readonly db: DbService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly classify: ClassifyApplier,
  ) {}

  /**
   * Channels currently being polled, by id.
   *
   * The overlap guard belongs HERE, not in the cron: the cron protected itself
   * with its own flag, but the manual "poll now" endpoint called straight into
   * this method and bypassed it. Two concurrent polls of one mailbox both read
   * the same cursor, both fetch the same UID, and both ingest — which is
   * exactly how nine real documents were duplicated on a live case. Guarding
   * the operation instead of one of its callers means a future caller cannot
   * reintroduce it.
   *
   * In-process, so it covers the single instance this runs on today; the
   * checksum check in ingestMessage is what holds if that ever changes.
   */
  private readonly inFlight = new Set<string>();

  /** Poll one email channel. Never throws — failures are returned and recorded. */
  async pollChannel(channel: ChannelRow): Promise<PollResult> {
    if (this.inFlight.has(channel.id)) {
      this.log.log(`Channel ${channel.id}: poll already in progress — skipped`);
      return { fetched: 0, imported: 0, unmatched: 0 };
    }
    this.inFlight.add(channel.id);
    try {
      return await this.pollChannelLocked(channel);
    } finally {
      this.inFlight.delete(channel.id);
    }
  }

  private async pollChannelLocked(channel: ChannelRow): Promise<PollResult> {
    if (!env.channelSecretKey) {
      return this.fail(channel, "CHANNEL_SECRET_KEY is not configured");
    }
    if (!channel.secretCiphertext) {
      return this.fail(channel, "Channel has no stored credential");
    }

    let password: string;
    try {
      password = openSecret(channel.secretCiphertext, env.channelSecretKey);
    } catch {
      return this.fail(channel, "Stored credential could not be decrypted");
    }

    const cfg = channel.config ?? {};
    const client = new ImapFlow({
      host: cfg.imapHost ?? "imap.gmail.com",
      port: cfg.imapPort ?? 993,
      secure: true,
      auth: { user: cfg.imapUser ?? channel.address, pass: password },
      // imapflow is chatty at info level; we do our own logging.
      logger: false,
    });

    let fetched = 0;
    let imported = 0;
    let unmatched = 0;

    try {
      await client.connect();
    } catch (e) {
      return this.fail(channel, `IMAP connect/auth failed: ${msg(e)}`);
    }

    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const mailbox = client.mailbox;
        if (!mailbox || typeof mailbox === "boolean") {
          return this.fail(channel, "Could not open INBOX");
        }
        const uidValidity = String(mailbox.uidValidity);
        const highestUid = Number(mailbox.uidNext) - 1;

        const prev = parseCursor(channel.cursor);

        // First connect, or the mailbox was recreated (uidValidity changed):
        // adopt "start from now" — record the current high-water mark and import
        // nothing historical. Importing an existing inbox of years-old mail onto
        // cases that do not exist is the wrong default, and irreversible once the
        // documents are created.
        if (!prev || prev.uidValidity !== uidValidity) {
          await this.saveCursor(channel.id, `${uidValidity}:${Math.max(highestUid, 0)}`);
          this.log.log(
            `Channel ${channel.id}: first sync — watermark set at uid ${highestUid}, no backfill`,
          );
          return { fetched: 0, imported: 0, unmatched: 0 };
        }

        const startUid = prev.lastUid + 1;
        if (startUid > highestUid) {
          // Nothing new. Still record the poll time so the UI shows it is alive.
          await this.saveCursor(channel.id, channel.cursor!);
          return { fetched: 0, imported: 0, unmatched: 0 };
        }

        let maxUid = prev.lastUid;
        // `${startUid}:*` — if startUid exceeds the highest, IMAP returns the
        // single highest message, so every UID is re-checked against lastUid.
        for await (const message of client.fetch(
          `${startUid}:*`,
          { uid: true, source: true, envelope: true },
          { uid: true },
        )) {
          if (message.uid <= prev.lastUid) continue;
          fetched++;
          maxUid = Math.max(maxUid, message.uid);
          const r = await this.ingestMessage(channel, message);
          imported += r.imported;
          if (r.imported === 0) unmatched++;
          // After the ingest transaction has committed: sort what just landed
          // into checklist slots. Fire-and-forget — a classifier hiccup must
          // never stall the poll loop or the cursor.
          if (r.imported > 0 && r.caseId) {
            void this.classify
              .processCase(channel.tenantId, r.caseId)
              .catch(() => {});
          }
        }

        await this.saveCursor(channel.id, `${uidValidity}:${maxUid}`);
      } finally {
        lock.release();
      }
    } catch (e) {
      return this.fail(channel, `Poll failed: ${msg(e)}`);
    } finally {
      await client.logout().catch(() => {});
    }

    this.log.log(
      `Channel ${channel.id}: ${fetched} new, ${imported} imported, ${unmatched} unmatched`,
    );
    return { fetched, imported, unmatched };
  }

  /** Parse one message and store its attachments as documents on the matched case. */
  private async ingestMessage(
    channel: ChannelRow,
    message: FetchMessageObject,
  ): Promise<{ imported: number; caseId: string | null }> {
    if (!message.source) return { imported: 0, caseId: null };
    const parsed = await simpleParser(message.source);

    const attachments = (parsed.attachments ?? []).filter(
      (a) => a.content && a.content.length > 0 && a.contentDisposition !== "inline",
    );

    const subject = parsed.subject ?? "";
    const fromEmail = parsed.from?.value?.[0]?.address?.toLowerCase() ?? null;
    const bodyText = (parsed.text ?? "").trim();
    // A message with no attachments, no words and no subject carries nothing
    // a human could ever want back. Everything else proceeds — a text-only
    // reply ("sending the rest tomorrow") used to be dropped entirely, which
    // made the Conversations view lie by omission.
    if (attachments.length === 0 && !bodyText && !subject) {
      return { imported: 0, caseId: null };
    }

    return this.db.withTenant(channel.tenantId, async (tx) => {
      const caseId = await this.matchCase(tx, subject, fromEmail);

      // Keep the WORDS as well as the files. Best-effort by design: a failure
      // to record the sentence must never cost the attachments behind it.
      // The unique index on (tenant, channel, external_id) collapses any
      // replayed delivery into one row.
      if (caseId) {
        try {
          await tx
            .insert(conversationMessages)
            .values({
              tenantId: channel.tenantId,
              caseId,
              channel: "email",
              direction: "inbound",
              sender: fromEmail ?? "unknown",
              subject: subject || null,
              body: bodyText.slice(0, MAX_CONVERSATION_CHARS),
              externalId: parsed.messageId ?? null,
              sentAt: parsed.date ?? new Date(),
            })
            .onConflictDoNothing();
        } catch (e) {
          this.log.warn(
            `Channel ${channel.id}: could not record message text for case ${caseId}: ${e instanceof Error ? e.message : e}`,
          );
        }
      }

      if (!caseId) {
        // Never guess — a misfiled KYC document is worse than an unfiled one.
        // But never lose it either: the cursor advances past this message, so
        // "left in the mailbox" means gone. Hold the bytes for a human instead.
        let held = 0;
        for (const att of attachments) {
          if (att.content.length > env.maxUploadBytes) {
            this.log.warn(
              `Channel ${channel.id}: unmatched attachment ${att.filename ?? "(unnamed)"} exceeds size limit — skipped`,
            );
            continue;
          }
          const stored = await this.holdUnmatched(tx, channel, {
            content: att.content,
            fileName: att.filename ?? `attachment-${message.uid}`,
            mimeType: att.contentType ?? null,
            sender: fromEmail,
            context: subject || null,
          });
          if (stored) held++;
        }
        this.log.warn(
          `Channel ${channel.id}: message uid ${message.uid} from ${fromEmail ?? "?"} matched no case — ${held} attachment(s) held for review`,
        );
        return { imported: 0, caseId: null };
      }

      let imported = 0;
      for (const att of attachments) {
        if (att.content.length > env.maxUploadBytes) {
          this.log.warn(
            `Channel ${channel.id}: attachment ${att.filename ?? "(unnamed)"} exceeds size limit — skipped`,
          );
          continue;
        }
        const fileName = att.filename ?? `attachment-${message.uid}`;

        // Same bytes already on this case? Skip. The WhatsApp path has always
        // deduped this way; the email path did not, and it showed: a manual
        // poll overlapping the cron ingested one message twice, putting nine
        // duplicate documents on a real case and paying to classify each one
        // twice. The per-channel lock below prevents that overlap, but this is
        // the check that holds regardless of HOW a message is seen twice —
        // a second instance, a replayed cursor, a forwarded copy.
        const checksum = createHash("sha256").update(att.content).digest("hex");
        const [dupe] = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(
            and(
              eq(documents.caseId, caseId),
              eq(documents.checksum, checksum),
              isNull(documents.deletedAt),
            ),
          )
          .limit(1);
        if (dupe) {
          this.log.log(
            `Channel ${channel.id}: ${fileName} already on case ${caseId} — skipped as duplicate`,
          );
          continue;
        }

        const [doc] = await tx
          .insert(documents)
          .values({
            tenantId: channel.tenantId,
            caseId,
            requirementId: null, // a human (later the AI) places it on the checklist
            fileName,
            mimeType: att.contentType ?? null,
            status: "received",
            sourceChannel: "email",
            sourceIdentifier: fromEmail,
          })
          .returning();

        const key = documentKey(channel.tenantId, caseId, doc.id);
        const stored = await this.storage.put(key, att.content, att.contentType);
        await tx
          .update(documents)
          .set({ storageKey: key, sizeBytes: stored.sizeBytes, checksum: stored.checksum })
          .where(eq(documents.id, doc.id));
        imported++;
      }
      return { imported, caseId };
    });
  }

  /**
   * Store one unmatched attachment for human triage. Bytes first, row second —
   * unmatched_documents.storage_key is NOT NULL, so a row can never exist
   * without its object. Deduped by checksum against the tenant's PENDING rows
   * only: a redelivered message doesn't pile up copies, while a resend after a
   * discard correctly surfaces again. Returns false when deduped/empty.
   */
  private async holdUnmatched(
    tx: Parameters<Parameters<DbService["withTenant"]>[1]>[0],
    channel: ChannelRow,
    att: {
      content: Buffer;
      fileName: string;
      mimeType: string | null;
      sender: string | null;
      context: string | null;
    },
  ): Promise<boolean> {
    if (att.content.length === 0) return false;
    const checksum = createHash("sha256").update(att.content).digest("hex");

    const [dupe] = await tx
      .select({ id: unmatchedDocuments.id })
      .from(unmatchedDocuments)
      .where(
        and(
          eq(unmatchedDocuments.tenantId, channel.tenantId),
          eq(unmatchedDocuments.checksum, checksum),
          eq(unmatchedDocuments.status, "pending"),
        ),
      )
      .limit(1);
    if (dupe) return false;

    const id = randomUUID();
    const key = unmatchedKey(channel.tenantId, id);
    const stored = await this.storage.put(key, att.content, att.mimeType ?? undefined);
    await tx.insert(unmatchedDocuments).values({
      id,
      tenantId: channel.tenantId,
      channel: channel.kind,
      sender: att.sender,
      context: att.context,
      fileName: att.fileName,
      mimeType: att.mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      storageKey: key,
    });
    return true;
  }

  /**
   * Which case does this message belong to? Runs inside withTenant, so every
   * lookup is already tenant-scoped. Returns null rather than guessing.
   */
  private async matchCase(
    tx: Parameters<Parameters<DbService["withTenant"]>[1]>[0],
    subject: string,
    fromEmail: string | null,
  ): Promise<string | null> {
    // 1. explicit reference in the subject — the strongest signal, since we are
    // the ones who put DKT-XXXXXX into the emails a subject replies to.
    for (const token of subject.match(/DKT[-\s]?[0-9A-Za-z]{6}/gi) ?? []) {
      const ref = normaliseCaseReference(token.replace(/\s/g, ""));
      if (!ref) continue;
      const [c] = await tx
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.reference, ref), isNull(cases.deletedAt)))
        .limit(1);
      if (c) return c.id;
    }

    // 2. the sender's email -> their most recent case.
    if (fromEmail) {
      const [c] = await tx
        .select({ id: cases.id })
        .from(cases)
        .innerJoin(contacts, eq(cases.contactId, contacts.id))
        .where(
          and(
            eq(contacts.email, fromEmail),
            isNull(cases.deletedAt),
            isNull(contacts.deletedAt),
          ),
        )
        .orderBy(desc(cases.createdAt))
        .limit(1);
      if (c) return c.id;
    }

    return null;
  }

  private async saveCursor(channelId: string, cursor: string): Promise<void> {
    // Written via the admin role: the poller runs outside any request, and the
    // channel row is looked up by id (not tenant-scoped here). Matching/inserts
    // above go through withTenant; this is only the poller's own bookkeeping.
    await this.db.admin
      .update(channels)
      .set({ cursor, lastPolledAt: new Date(), lastError: null })
      .where(eq(channels.id, channelId));
  }

  private async fail(channel: ChannelRow, error: string): Promise<PollResult> {
    this.log.error(`Channel ${channel.id}: ${error}`);
    await this.db.admin
      .update(channels)
      .set({ lastPolledAt: new Date(), lastError: error })
      .where(eq(channels.id, channel.id))
      .catch(() => {});
    return { fetched: 0, imported: 0, unmatched: 0, error };
  }
}

function parseCursor(cursor: string | null): { uidValidity: string; lastUid: number } | null {
  if (!cursor) return null;
  const [uidValidity, uid] = cursor.split(":");
  const lastUid = Number(uid);
  if (!uidValidity || Number.isNaN(lastUid)) return null;
  return { uidValidity, lastUid };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
