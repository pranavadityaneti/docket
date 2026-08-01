import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Logger,
  Module,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { createHash, timingSafeEqual } from "node:crypto";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { eq } from "drizzle-orm";
import { tenants } from "@docket/db";
import { DbService } from "../db/db";
import { CasesModule, CasesService } from "../cases/cases";
import { env } from "../config/env";

/**
 * Machine intake — how a case is born from OUTSIDE the dashboard.
 *
 * The first client is the marketing site's loan-enquiry form: a visitor
 * submits, the form's server forwards here, and the case appears on the board
 * with the subject's email and phone already set — which matters because those
 * two fields are the routing keys every later WhatsApp message and email is
 * matched by. Case creation also sends the initial document request (that is
 * CasesService.create's own behaviour), so the borrower's inbox has the
 * checklist before staff have even opened the case.
 *
 * AUTH: a shared API key in the `x-intake-key` header, never a JWT — the
 * caller is a server, not a person. The key lives in Secrets Manager beside
 * everything else and is compared in constant time. No key configured = the
 * endpoint answers 503 for everyone; it can never fail open.
 *
 * TENANCY: the key maps to exactly ONE tenant (INTAKE_TENANT_SLUG). A future
 * with several intake clients moves this to per-tenant keys on the channels
 * table; one global key is right while there is one website.
 */

export class IntakeEnquiryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  organisation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  pan?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gst?: string;

  /** Kept as strings end-to-end: the form sends text and data is jsonb. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  loanAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  turnover?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  workflow?: string;
}

/** Constant-time equality over digests, so length differences leak nothing. */
function keyMatches(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Digits-only (plus optional leading +) so "98765 43210" routes like "9876543210". */
function normalisePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return cleaned.length > 0 ? cleaned : undefined;
}

@UseGuards(ThrottlerGuard)
@Controller("intake")
export class IntakeController {
  private readonly log = new Logger(IntakeController.name);

  constructor(
    private readonly db: DbService,
    private readonly cases: CasesService,
  ) {}

  /**
   * 20/min: a marketing site submits at human speed; a runaway retry loop or
   * a scraper does not get to mint cases (each of which sends a real email).
   */
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("enquiry")
  async enquiry(@Headers("x-intake-key") key: string | undefined, @Body() dto: IntakeEnquiryDto) {
    if (!env.intakeApiKey) {
      // Not configured is a server condition, not a caller error — and it
      // must never fall open into "no key required".
      throw new ServiceUnavailableException("Intake is not configured");
    }
    if (!key || !keyMatches(key, env.intakeApiKey)) {
      throw new UnauthorizedException("Bad intake key");
    }

    const phone = normalisePhone(dto.phone);
    // Without at least one routing key the case would be a dead end: nothing
    // the subject ever sends could be matched back to it.
    if (!dto.email && !phone) {
      throw new BadRequestException("email or phone is required");
    }

    const [tenant] = await this.db.admin
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, env.intakeTenantSlug))
      .limit(1);
    if (!tenant) {
      this.log.error(`Intake tenant "${env.intakeTenantSlug}" does not exist`);
      throw new ServiceUnavailableException("Intake is not configured");
    }

    // Field keys follow the workflow's field config (business-loan-config.ts);
    // unknown keys are stored but not displayed, so nothing here can break the UI.
    const data: Record<string, unknown> = {};
    if (dto.pan) data.pan_number = dto.pan.toUpperCase().replace(/\s/g, "");
    if (dto.gst) data.business_gst = dto.gst.toUpperCase().replace(/\s/g, "");
    if (dto.organisation) data.company_name = dto.organisation;
    if (dto.loanAmount && /^\d+$/.test(dto.loanAmount)) data.loan_amount = Number(dto.loanAmount);
    if (dto.turnover && /^\d+$/.test(dto.turnover)) data.monthly_turnover = Number(dto.turnover);
    if (dto.message?.trim()) data.funds_needed = dto.message.trim();
    data.source = "Website";

    const created = await this.cases.create(tenant.id, {
      name: dto.name,
      kind: "person",
      organisation: dto.organisation,
      email: dto.email,
      phone,
      source: "Website",
      workflow: dto.workflow ?? "business-loan",
      data,
    });

    this.log.log(`Intake enquiry created case ${created.reference}`);
    // The reference alone: enough for the caller to show or log, nothing that
    // enumerates internal ids.
    return { reference: created.reference };
  }
}

@Module({
  imports: [CasesModule],
  controllers: [IntakeController],
})
export class IntakeModule {}
