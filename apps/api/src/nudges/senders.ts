import { openSecret, type NudgeSnapshotItem } from "@docket/db";
import { Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { env } from "../config/env";
import { composeEmail, composeWhatsappParams, type ComposeContext } from "./compose";

export type SendOutcome = { ok: true } | { ok: false; error: string };

/**
 * Sends the document-request email via Resend.
 *
 * Reply-To is the tenant's own mailbox address, not ours: the subject's reply
 * (with attachments) must land where the email poller reads it, so it can be
 * matched back to the case. From uses the tenant's name as display name over
 * our verified sending domain - the subject sees their lender, not Docket.
 */
@Injectable()
export class EmailNudgeSender {
  private readonly log = new Logger(EmailNudgeSender.name);
  private readonly resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

  configured(): boolean {
    return !!this.resend && !!env.resendFromEmail;
  }

  /** Returns the subject line used (for the audit row) alongside the outcome. */
  async send(
    to: string,
    replyTo: string,
    items: NudgeSnapshotItem[],
    ctx: ComposeContext,
  ): Promise<SendOutcome & { subject: string }> {
    const { subject, text } = composeEmail(items, ctx);
    if (!this.resend || !env.resendFromEmail) {
      return { ok: false, error: "Resend not configured", subject };
    }
    const { error } = await this.resend.emails.send({
      from: `${ctx.tenantName} <${env.resendFromEmail}>`,
      to,
      replyTo,
      subject,
      text,
    });
    if (error) {
      const msg = error.message ?? String(error);
      this.log.error(`Nudge email to ${to} failed: ${msg}`);
      return { ok: false, error: msg, subject };
    }
    return { ok: true, subject };
  }

  /**
   * Free-form staff reply on the Conversations tab. Same From / Reply-To
   * shape as the nudge so inbound replies still hit the tenant mailbox.
   */
  async sendText(opts: {
    to: string;
    replyTo: string;
    fromName: string;
    subject: string;
    text: string;
  }): Promise<SendOutcome & { subject: string }> {
    const { to, replyTo, fromName, subject, text } = opts;
    if (!this.resend || !env.resendFromEmail) {
      return { ok: false, error: "Resend not configured", subject };
    }
    const { error } = await this.resend.emails.send({
      from: `${fromName} <${env.resendFromEmail}>`,
      to,
      replyTo,
      subject,
      text,
    });
    if (error) {
      const msg = error.message ?? String(error);
      this.log.error(`Reply email to ${to} failed: ${msg}`);
      return { ok: false, error: msg, subject };
    }
    return { ok: true, subject };
  }
}

/** Decrypted WhatsApp credential (same shape the webhook stores). */
interface WhatsappSecret {
  accessToken: string;
  appSecret: string;
}

/**
 * Sends the `document_request` template via the WhatsApp Cloud API.
 *
 * Business-initiated messages must be a Meta-approved template, so this is
 * template-only by design. It stays dormant until a whatsapp channel exists with
 * a templateName in its config - NudgeService gates that - so shipping this now
 * costs nothing and it activates the moment the channel + template land.
 */
@Injectable()
export class WhatsappNudgeSender {
  private readonly log = new Logger(WhatsappNudgeSender.name);

  async send(
    channel: { config: Record<string, unknown> | null; secretCiphertext: string | null },
    recipientPhone: string,
    items: NudgeSnapshotItem[],
    ctx: ComposeContext,
  ): Promise<SendOutcome> {
    const cfg = channel.config ?? {};
    const templateName = typeof cfg.templateName === "string" ? cfg.templateName : null;
    const phoneNumberId = typeof cfg.phoneNumberId === "string" ? cfg.phoneNumberId : null;
    // Meta matches the language code against the approved template EXACTLY - "en"
    // and "en_US" are different templates to them, and a mismatch fails every
    // send. Configurable per channel so the code always matches what was approved.
    const templateLanguage = typeof cfg.templateLanguage === "string" ? cfg.templateLanguage : "en";
    if (!templateName || !phoneNumberId) {
      return { ok: false, error: "WhatsApp channel missing templateName/phoneNumberId" };
    }
    if (!env.channelSecretKey || !channel.secretCiphertext) {
      return { ok: false, error: "WhatsApp channel has no usable credential" };
    }

    let accessToken: string;
    try {
      // Same seal/open shape the webhook stores. Kept local rather than coupling
      // the nudge feature to the webhook module; a shared channels-credential
      // util is a later consolidation, not this feature's scope.
      const parsed = JSON.parse(openSecret(channel.secretCiphertext, env.channelSecretKey)) as
        | Partial<WhatsappSecret>
        | undefined;
      if (!parsed?.accessToken) return { ok: false, error: "credential missing accessToken" };
      accessToken = parsed.accessToken;
    } catch {
      return { ok: false, error: "credential could not be decrypted" };
    }

    const params = composeWhatsappParams(items, ctx);
    const to = recipientPhone.replace(/\D/g, "");
    if (!to) return { ok: false, error: "recipient has no usable phone number" };

    try {
      const res = await fetch(
        `https://graph.facebook.com/${env.graphApiVersion}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
              name: templateName,
              language: { code: templateLanguage },
              components: [
                { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
              ],
            },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const msg = `WhatsApp send ${res.status}: ${detail.slice(0, 200)}`;
        this.log.error(msg);
        return { ok: false, error: msg };
      }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error(`WhatsApp send failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  /**
   * Session (free-text) WhatsApp message. Requires an open customer-care
   * window after the subject messaged in; Meta rejects outside that window.
   */
  async sendText(
    channel: { config: Record<string, unknown> | null; secretCiphertext: string | null },
    recipientPhone: string,
    text: string,
  ): Promise<SendOutcome & { externalId?: string }> {
    const cfg = channel.config ?? {};
    const phoneNumberId = typeof cfg.phoneNumberId === "string" ? cfg.phoneNumberId : null;
    if (!phoneNumberId) {
      return { ok: false, error: "WhatsApp channel missing phoneNumberId" };
    }
    if (!env.channelSecretKey || !channel.secretCiphertext) {
      return { ok: false, error: "WhatsApp channel has no usable credential" };
    }

    let accessToken: string;
    try {
      const parsed = JSON.parse(openSecret(channel.secretCiphertext, env.channelSecretKey)) as
        | Partial<WhatsappSecret>
        | undefined;
      if (!parsed?.accessToken) return { ok: false, error: "credential missing accessToken" };
      accessToken = parsed.accessToken;
    } catch {
      return { ok: false, error: "credential could not be decrypted" };
    }

    const to = recipientPhone.replace(/\D/g, "");
    if (!to) return { ok: false, error: "recipient has no usable phone number" };

    try {
      const res = await fetch(
        `https://graph.facebook.com/${env.graphApiVersion}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { preview_url: false, body: text },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const msg = `WhatsApp text send ${res.status}: ${detail.slice(0, 200)}`;
        this.log.error(msg);
        return { ok: false, error: msg };
      }
      const payload = (await res.json().catch(() => null)) as
        | { messages?: { id?: string }[] }
        | null;
      const externalId = payload?.messages?.[0]?.id;
      return { ok: true, externalId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error(`WhatsApp text send failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}
