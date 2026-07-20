import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  users,
  memberships,
  tenants,
  passwordResetTokens,
  verifyPassword,
  hashPassword,
  generateResetToken,
  hashResetToken,
} from "@docket/db";
import { DbService } from "../db/db";
import { EmailModule, EmailService } from "../email/email";
import { env } from "../config/env";

export type AuthUser = { userId: string; tenantId: string; role: string };

export class LoginDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  // ≥12 matches the manual-reset helper's rule; the server is authoritative.
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;
}

// Hash of an arbitrary, never-used string — not a real credential. Verified
// against on every login where the real user/hash lookup misses, so argon2's
// (deliberately costly) computation runs on every attempt regardless of
// whether the account exists. Without this, an unknown-email or
// no-password-set request short-circuits before hashing while a wrong
// password on a real account does not — a timing side-channel that lets an
// attacker enumerate valid emails even though the error message is identical.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$6I7QyPRhpNUWqg8thD0S0Q$CmdZjwGsFqTdBRlsUx6TYStwwwZFVFnSuWjooRlaUOY";

/**
 * Rate-limits login by IP *and* account, not IP alone.
 *
 * Lender staff typically share one office IP behind NAT. Keying on IP alone
 * would mean one colleague mistyping their password five times locks out
 * everyone in the building — and since the throttler counts every attempt (not
 * just failures), a handful of people signing in at 9am would collide too.
 * Keying on ip+email caps brute force against any single account — the actual
 * threat — without that collateral.
 *
 * Guards run before pipes, so req.body here is the raw payload rather than a
 * validated LoginDto; the email is normalised defensively so that casing or
 * padding can't be used to get a fresh bucket per attempt.
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const raw = req?.body?.email;
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : "unknown";
    return `${req.ip}:${email}`;
  }
}

/** Attaches req.user = { userId, tenantId, role } from a validated Bearer JWT. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers["authorization"];
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    try {
      const payload = await this.jwt.verifyAsync(header.slice(7));
      req.user = { userId: payload.sub, tenantId: payload.tenantId, role: payload.role };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid token");
    }
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  async login(email: string, password: string) {
    const clean = email.trim().toLowerCase();
    const [user] = await this.db.admin.select().from(users).where(eq(users.email, clean)).limit(1);
    // Always verify against a real hash — the user's if they have one, the
    // fixed dummy otherwise — so this await runs on every attempt. Skipping it
    // when the user/hash lookup misses would make those requests return
    // faster than a wrong-password-on-a-real-account request, letting an
    // attacker enumerate valid emails by response time alone.
    const passwordOk = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);
    // Same generic message whether the email is unknown, has no password set,
    // or the password is wrong — never reveal which, to avoid user enumeration.
    if (!user || !user.passwordHash || !passwordOk) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const [m] = await this.db.admin
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .limit(1);
    if (!m) throw new UnauthorizedException("No workspace membership");

    const [tenant] = await this.db.admin
      .select()
      .from(tenants)
      .where(eq(tenants.id, m.tenantId))
      .limit(1);

    const token = await this.jwt.signAsync({ sub: user.id, tenantId: m.tenantId, role: m.role });
    return {
      token,
      user: { id: user.id, name: user.name, email: user.email },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      role: m.role,
    };
  }

  /**
   * Start a reset. ALWAYS resolves to { ok: true } — the caller cannot tell
   * whether the email exists (no enumeration), mirroring login's dummy-hash
   * posture. If it does exist, prior unused tokens are superseded, a fresh one
   * is issued, and the link is emailed; a send failure is swallowed (logged in
   * the email module) so it can never reveal the account.
   */
  async forgotPassword(email: string): Promise<{ ok: true }> {
    const clean = email.trim().toLowerCase();
    const [user] = await this.db.admin.select().from(users).where(eq(users.email, clean)).limit(1);
    if (user) {
      const now = new Date();
      // Only the newest link should work: retire any still-valid unused tokens.
      await this.db.admin
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, now),
          ),
        );
      const { raw, hash } = generateResetToken();
      await this.db.admin.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000), // 1 hour
      });
      await this.email.sendPasswordResetEmail(
        user.email,
        `${env.appOrigin}/reset?token=${encodeURIComponent(raw)}`,
      );
    }
    return { ok: true };
  }

  /**
   * Complete a reset. Generic 400 on any bad/expired/used token — never reveals
   * which. On success sets the new argon2 hash and consumes the token.
   */
  async resetPassword(token: string, password: string): Promise<{ ok: true }> {
    const hash = hashResetToken(token);
    const [row] = await this.db.admin
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, hash))
      .limit(1);
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("This reset link is invalid or has expired.");
    }
    const passwordHash = await hashPassword(password);
    await this.db.admin.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
    await this.db.admin
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));
    return { ok: true };
  }
}

@Controller("auth")
@UseGuards(LoginThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Argon2 makes each guess expensive for us as well as the attacker, so the
  // password endpoint is the one place that needs a hard cap: 5 attempts per
  // minute per ip+account, then a 5-minute lockout. Deliberately tight — a
  // human fat-fingering their password twice never reaches it.
  @Post("login")
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 300_000 } })
  login(@Body() body: LoginDto) {
    // email/password presence + format are enforced by the global ValidationPipe.
    return this.auth.login(body.email, body.password);
  }

  // Always 200 (no account enumeration). Tighter than login — a real user asks
  // for a reset once, not three times a minute.
  @Post("forgot-password")
  @Throttle({ default: { limit: 3, ttl: 60_000, blockDuration: 300_000 } })
  forgot(@Body() body: ForgotPasswordDto) {
    return this.auth.forgotPassword(body.email);
  }

  @Post("reset-password")
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 300_000 } })
  reset(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body.token, body.password);
  }
}

@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
