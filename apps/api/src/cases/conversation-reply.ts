import {
  cases,
  channels,
  contacts,
  conversationMessages,
  tenants,
  type ChannelKind,
} from "@docket/db";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { DbService } from "../db/db";
import { EmailNudgeSender, WhatsappNudgeSender } from "../nudges/senders";

const MAX_REPLY_CHARS = 8_000;

export class ReplyConversationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_REPLY_CHARS)
  body!: string;

  /**
   * Optional override. When omitted, the latest inbound message's channel
   * wins so the reply rides the same medium the subject just used.
   */
  @IsOptional()
  @IsIn(["email", "whatsapp"])
  channel?: ChannelKind;
}

function replySubject(caseReference: string, priorSubject: string | null): string {
  const base = (priorSubject ?? "").trim();
  if (!base) return `Re: ${caseReference}`;
  return /^re:\s/i.test(base) ? base : `Re: ${base}`;
}

/**
 * Staff free-form replies on the Conversations tab.
 *
 * Channel defaults to the latest *inbound* conversation_messages row so a
 * WhatsApp thread stays on WhatsApp and email stays on email - not the nudge
 * fan-out that blasts every reachable channel.
 */
@Injectable()
export class ConversationReplyService {
  constructor(
    private readonly db: DbService,
    private readonly email: EmailNudgeSender,
    private readonly whatsapp: WhatsappNudgeSender,
  ) {}

  async reply(tenantId: string, caseId: string, input: ReplyConversationDto) {
    const body = input.body.trim().slice(0, MAX_REPLY_CHARS);
    if (!body) throw new BadRequestException("Message needs some text");

    return this.db.withTenant(tenantId, async (tx) => {
      const [ctx] = await tx
        .select({
          id: cases.id,
          reference: cases.reference,
          contactEmail: contacts.email,
          contactPhone: contacts.phone,
          tenantName: tenants.name,
        })
        .from(cases)
        .innerJoin(tenants, eq(cases.tenantId, tenants.id))
        .leftJoin(contacts, eq(cases.contactId, contacts.id))
        .where(and(eq(cases.id, caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!ctx) throw new NotFoundException("Case not found");

      const [lastInbound] = await tx
        .select({
          channel: conversationMessages.channel,
          sender: conversationMessages.sender,
          subject: conversationMessages.subject,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.caseId, caseId),
            eq(conversationMessages.direction, "inbound"),
          ),
        )
        .orderBy(desc(conversationMessages.sentAt))
        .limit(1);

      let channel: ChannelKind | undefined = input.channel ?? lastInbound?.channel;
      if (!channel) {
        if (ctx.contactEmail) channel = "email";
        else if (ctx.contactPhone) channel = "whatsapp";
        else {
          throw new BadRequestException(
            "No prior customer message, and no email or phone on file",
          );
        }
      }

      if (channel === "email") {
        const to =
          (lastInbound?.channel === "email" ? lastInbound.sender : null) ||
          ctx.contactEmail;
        if (!to) {
          throw new BadRequestException("No email address on file for this subject");
        }
        const [emailCh] = await tx
          .select()
          .from(channels)
          .where(and(eq(channels.kind, "email"), eq(channels.enabled, true)))
          .orderBy(asc(channels.createdAt))
          .limit(1);
        if (!emailCh) {
          throw new BadRequestException("No email channel is connected");
        }
        if (!this.email.configured()) {
          throw new BadRequestException("Email sending is not configured");
        }

        const subject = replySubject(
          ctx.reference,
          lastInbound?.channel === "email" ? lastInbound.subject : null,
        );
        const sent = await this.email.sendText({
          to,
          replyTo: emailCh.address,
          fromName: ctx.tenantName,
          subject,
          text: body,
        });
        if (!sent.ok) {
          throw new BadRequestException(sent.error || "Email failed to send");
        }

        const [row] = await tx
          .insert(conversationMessages)
          .values({
            tenantId,
            caseId,
            channel: "email",
            direction: "outbound",
            sender: to,
            subject: sent.subject,
            body,
          })
          .returning();

        return this.toEntry(row!);
      }

      // whatsapp
      const to =
        (lastInbound?.channel === "whatsapp" ? lastInbound.sender : null) ||
        ctx.contactPhone;
      if (!to) {
        throw new BadRequestException("No phone number on file for this subject");
      }
      const [waCh] = await tx
        .select()
        .from(channels)
        .where(and(eq(channels.kind, "whatsapp"), eq(channels.enabled, true)))
        .orderBy(asc(channels.createdAt))
        .limit(1);
      if (!waCh) {
        throw new BadRequestException("No WhatsApp channel is connected");
      }

      const sent = await this.whatsapp.sendText(waCh, to, body);
      if (!sent.ok) {
        throw new BadRequestException(sent.error || "WhatsApp failed to send");
      }

      const [row] = await tx
        .insert(conversationMessages)
        .values({
          tenantId,
          caseId,
          channel: "whatsapp",
          direction: "outbound",
          sender: to,
          subject: null,
          body,
          externalId: sent.externalId ?? null,
        })
        .returning();

      return this.toEntry(row!);
    });
  }

  private toEntry(m: typeof conversationMessages.$inferSelect) {
    return {
      id: m.id,
      channel: m.channel,
      direction: m.direction,
      counterpart: m.sender,
      subject: m.subject,
      body: m.body,
      kind: null as string | null,
      failed: false,
      at: m.sentAt,
      attachments: [] as { id: string; fileName: string; mimeType: string | null }[],
    };
  }
}
