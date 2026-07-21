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
import { channels, sealSecret, type ChannelConfig } from "@docket/db";
import { DbService } from "../db/db";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { StorageModule } from "../storage/storage";
import { EmailPollerService, type PollResult } from "./email-poller";
import { env } from "../config/env";

/**
 * Channels: the mailbox (and later WhatsApp number) a tenant's subjects write
 * to. See channels in the schema for why this is per-tenant — it is the
 * white-label promise, not a setting.
 *
 * The API never returns a stored credential. It goes in encrypted via
 * sealSecret and only the poller ever decrypts it, in memory, to hand to IMAP.
 */

export class CreateEmailChannelDto {
  /** The address subjects send to — what they see on the tenant's brand. */
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

/** A channel as returned to the client — never includes the credential. */
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
  ) {}

  /** The tenant's channels, without secrets. */
  list(tenantId: string) {
    return this.db.withTenant(tenantId, (tx) =>
      tx.select(SAFE_COLUMNS).from(channels).where(eq(channels.tenantId, tenantId)),
    );
  }

  async createEmail(tenantId: string, input: CreateEmailChannelDto) {
    if (!env.channelSecretKey) {
      // Refuse rather than store a credential in the clear — the whole point of
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

  /** Poll one channel on demand — used for setup verification and the demo. */
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
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.channels.list(u.tenantId);
  }

  @Post("email")
  createEmail(@CurrentUser() u: AuthUser, @Body() body: CreateEmailChannelDto) {
    return this.channels.createEmail(u.tenantId, body);
  }

  @Post(":id/poll")
  poll(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.channels.pollNow(u.tenantId, id);
  }
}

@Module({
  imports: [ScheduleModule.forRoot(), StorageModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, EmailPollerService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
