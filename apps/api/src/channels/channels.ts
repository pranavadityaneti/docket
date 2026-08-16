import { channels, sealSecret, type ChannelConfig } from "@docket/db";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Cron, CronExpression, ScheduleModule } from "@nestjs/schedule";
import { IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { and, eq } from "drizzle-orm";
import { AuthModule, CurrentUser, JwtAuthGuard, PrivilegeGuard, RequirePrivilege, type AuthUser } from "../auth/auth";
import { ClassifyModule } from "../classify/classify";
import { env } from "../config/env";
import { DbService } from "../db/db";
import { NotificationsModule } from "../notifications/notifications";
import { StorageModule } from "../storage/storage";
import { EmailPollerService, type PollResult } from "./email-poller";
import { WhatsappService, WhatsappWebhookController } from "./whatsapp-webhook";

/**
 * Channels: the mailbox (and later WhatsApp number) a tenant's subjects write
 * to. See channels in the schema for why this is per-tenant - it is the
 * white-label promise, not a setting.
 *
 * The API never returns a stored credential. It goes in encrypted via
 * sealSecret and only the poller ever decrypts it, in memory, to hand to IMAP.
 */

export class CreateEmailChannelDto {
  /** The address subjects send to - what they see on the tenant's brand. */
  @IsEmail()
  @MaxLength(320)
  address!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  imapHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  imapPort?: number;

  /** Defaults to the address; set only when the login differs from the address. */
  @IsOptional()
  @IsString()
  @MaxLength(320)
  imapUser?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password!: string;
}

export class CreateWhatsappChannelDto {
  /** The WhatsApp number subjects see, for display (e.g. "+1 555 010 1234"). */
  @IsString()
  @MaxLength(64)
  address!: string;

  /** Meta's phone number ID - the routing key the webhook matches on. */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  phoneNumberId!: string;

  /** Access token used to download inbound media from the Graph API. */
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  accessToken!: string;

  /** App secret used to verify the X-Hub-Signature-256 on every delivery. */
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  appSecret!: string;
}

/** A channel as returned to the client - never includes the credential. */
const SAFE_COLUMNS = {
  id: channels.id,
  kind: channels.kind,
  address: channels.address,
  enabled: channels.enabled,
  config: channels.config,
  lastPolledAt: channels.lastPolledAt,
  lastError: channels.lastError,
  createdAt: channels.createdAt,
} as const;

@Injectable()
export class ChannelsService {
  constructor(
    private readonly db: DbService,
    private readonly poller: EmailPollerService,
  ) { }

  /** The tenant's channels, without secrets. */
  list(tenantId: string) {
    return this.db.withTenant(tenantId, (tx) =>
      tx.select(SAFE_COLUMNS).from(channels).where(eq(channels.tenantId, tenantId)),
    );
  }

  async createEmail(tenantId: string, input: CreateEmailChannelDto) {
    if (!env.channelSecretKey) {
      // Refuse rather than store a credential in the clear - the whole point of
      // secret-box is that this never happens.
      throw new BadRequestException(
        "Email channels are unavailable: the server has no channel encryption key configured.",
      );
    }
    const config: ChannelConfig = {
      imapHost: input.imapHost ?? "imap.gmail.com",
      imapPort: input.imapPort ?? 993,
      imapUser: input.imapUser ?? input.address,
    };
    const secretCiphertext = sealSecret(input.password, env.channelSecretKey);

    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .insert(channels)
        .values({ tenantId, kind: "email", address: input.address, config, secretCiphertext })
        .returning(SAFE_COLUMNS);
      return row;
    });
  }

  async createWhatsapp(tenantId: string, input: CreateWhatsappChannelDto) {
    if (!env.channelSecretKey) {
      throw new BadRequestException(
        "WhatsApp channels are unavailable: the server has no channel encryption key configured.",
      );
    }
    const config: ChannelConfig = { phoneNumberId: input.phoneNumberId };
    // Both credentials sealed together - the webhook needs the access token to
    // download media and the app secret to verify signatures. Never returned.
    const secretCiphertext = sealSecret(
      JSON.stringify({ accessToken: input.accessToken, appSecret: input.appSecret }),
      env.channelSecretKey,
    );

    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .insert(channels)
        .values({ tenantId, kind: "whatsapp", address: input.address, config, secretCiphertext })
        .returning(SAFE_COLUMNS);
      return row;
    });
  }

  /** Poll one channel on demand - used for setup verification and the demo. */
  async pollNow(tenantId: string, channelId: string): Promise<PollResult> {
    const [row] = await this.db.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(channels)
        .where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)))
        .limit(1),
    );
    if (!row) throw new NotFoundException("Channel not found");
    if (row.kind !== "email") throw new BadRequestException("Not an email channel");
    return this.poller.pollChannel(row);
  }

  /**
   * Poll every enabled email channel. Runs across tenants via the admin role
   * (this is not a request), and each channel's own writes go through
   * withTenant inside the poller.
   */
  private polling = false;
  @Cron(CronExpression.EVERY_MINUTE)
  async pollAllDue(): Promise<void> {
    if (this.polling) return; // never overlap a slow poll with the next tick
    this.polling = true;
    try {
      const due = await this.db.admin
        .select()
        .from(channels)
        .where(and(eq(channels.kind, "email"), eq(channels.enabled, true)));
      for (const channel of due) {
        await this.poller.pollChannel(channel);
      }
    } finally {
      this.polling = false;
    }
  }
}

@Controller("channels")
@UseGuards(JwtAuthGuard, PrivilegeGuard)
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) { }

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.channels.list(u.tenantId);
  }

  @Post("email")
  @RequirePrivilege("channels.manage")
  createEmail(@CurrentUser() u: AuthUser, @Body() body: CreateEmailChannelDto) {
    return this.channels.createEmail(u.tenantId, body);
  }

  @Post("whatsapp")
  @RequirePrivilege("channels.manage")
  createWhatsapp(@CurrentUser() u: AuthUser, @Body() body: CreateWhatsappChannelDto) {
    return this.channels.createWhatsapp(u.tenantId, body);
  }

  @Post(":id/poll")
  poll(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.channels.pollNow(u.tenantId, id);
  }
}

@Module({
  imports: [AuthModule, ScheduleModule.forRoot(), StorageModule, ClassifyModule, NotificationsModule],
  controllers: [ChannelsController, WhatsappWebhookController],
  providers: [ChannelsService, EmailPollerService, WhatsappService],
  exports: [ChannelsService],
})
export class ChannelsModule { }
