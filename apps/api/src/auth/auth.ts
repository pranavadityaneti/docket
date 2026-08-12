import {
  generateResetToken,
  hashPassword,
  hashResetToken,
  memberships,
  passwordResetTokens,
  tenants,
  users,
  verifyPassword,
} from "@docket/db";
import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Patch,
  Post,
  Req,
  Res,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import type { Request, Response } from "express";
import { env } from "../config/env";
import { matchTenantHost, originForSlug, isAllowedWebOrigin } from "../config/tenant-host";
import { DbService } from "../db/db";
import { EmailModule, EmailService } from "../email/email";
import { clearAuthCookies, extractAccessToken, setAuthCookies } from "./cookies";

export type AuthUser = { userId: string; tenantId: string; role: string };

const ROLES_KEY = "roles";

/** Restrict a route to the given membership roles (JWT `role`). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Enforces `@Roles(...)`. Must sit after JwtAuthGuard so `req.user` exists.
 * Missing decorator = allow (this guard only denies when roles were declared).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) { }

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException(
        "Only workspace owners and admins can change this.",
      );
    }
    return true;
  }
}

export class LoginDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  /** Workspace slug from the browser host (`acme` for acme-uat.finlot.ai). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  tenantSlug?: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tenantSlug?: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;
}

export class UpdateWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$6I7QyPRhpNUWqg8thD0S0Q$CmdZjwGsFqTdBRlsUx6TYStwwwZFVFnSuWjooRlaUOY";

@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const raw = req?.body?.email;
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : "unknown";
    return `${req.ip}:${email}`;
  }
}

/**
 * Attaches req.user from a validated JWT.
 * Accepts Authorization: Bearer ... OR the httpOnly docket_token cookie.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) { }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractAccessToken(req);
    if (!token) {
      throw new UnauthorizedException("Missing session");
    }
    try {
      const payload = await this.jwt.verifyAsync(token);
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
  ) { }

  async login(email: string, password: string, tenantSlug?: string) {
    const clean = email.trim().toLowerCase();
    const [user] = await this.db.admin.select().from(users).where(eq(users.email, clean)).limit(1);
    const passwordOk = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);
    if (!user || !user.passwordHash || !passwordOk) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const slug = tenantSlug?.trim().toLowerCase() || undefined;
    let membership:
      | { tenantId: string; role: string }
      | undefined;
    let tenant: { id: string; name: string; slug: string } | undefined;

    if (slug) {
      const [row] = await this.db.admin
        .select({
          tenantId: memberships.tenantId,
          role: memberships.role,
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.userId, user.id), eq(tenants.slug, slug)))
        .limit(1);
      if (!row) {
        throw new UnauthorizedException("No access to this workspace");
      }
      membership = { tenantId: row.tenantId, role: row.role };
      tenant = { id: row.id, name: row.name, slug: row.slug };
    } else {
      // Legacy single-host login: first membership wins.
      const [m] = await this.db.admin
        .select()
        .from(memberships)
        .where(eq(memberships.userId, user.id))
        .limit(1);
      if (!m) throw new UnauthorizedException("No workspace membership");
      const [t] = await this.db.admin
        .select()
        .from(tenants)
        .where(eq(tenants.id, m.tenantId))
        .limit(1);
      if (!t) throw new UnauthorizedException("Workspace not found");
      membership = { tenantId: m.tenantId, role: m.role };
      tenant = { id: t.id, name: t.name, slug: t.slug };
    }

    const token = await this.jwt.signAsync({
      sub: user.id,
      tenantId: membership.tenantId,
      role: membership.role,
    });
    return {
      token,
      user: { id: user.id, name: user.name, email: user.email },
      tenant,
      role: membership.role,
    };
  }

  async me(userId: string, tenantId: string) {
    const [user] = await this.db.admin
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new UnauthorizedException("User not found");
    const [tenant] = await this.db.admin
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) throw new UnauthorizedException("Workspace not found");
    const [m] = await this.db.admin
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
      .limit(1);
    if (!m) throw new UnauthorizedException("Not a member of this workspace");
    return { user, tenant, role: m.role };
  }

  /** Workspace members - for case owner assignment. */
  listMembers(tenantId: string) {
    return this.db.admin
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.tenantId, tenantId))
      .orderBy(asc(users.name));
  }

  /**
   * Rename the workspace for every member. Slug stays fixed - it is the
   * stable workspace key, not display chrome.
   */
  async updateWorkspace(tenantId: string, name: string) {
    const clean = name.trim();
    if (!clean) throw new BadRequestException("Workspace name is required");
    if (clean.length > 80) {
      throw new BadRequestException("Workspace name must be 80 characters or fewer");
    }
    const [row] = await this.db.admin
      .update(tenants)
      .set({ name: clean })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id, name: tenants.name, slug: tenants.slug });
    if (!row) throw new NotFoundException("Workspace not found");
    return row;
  }

  async forgotPassword(email: string, tenantSlug?: string, requestOrigin?: string): Promise<{ ok: true }> {
    const clean = email.trim().toLowerCase();
    const [user] = await this.db.admin.select().from(users).where(eq(users.email, clean)).limit(1);
    if (user) {
      const now = new Date();
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
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      });

      const fromOrigin = requestOrigin ? matchTenantHost(requestOrigin) : null;
      const slug = (tenantSlug?.trim().toLowerCase() || fromOrigin?.slug || "").trim();
      let appOrigin = env.appOrigin;
      if (slug) {
        const kind = fromOrigin?.kind ?? (env.tenantOriginTemplate?.includes("-uat") ? "uat" : "prod");
        const built = originForSlug(slug, env.tenantOriginTemplate, kind);
        // Only emit links for origins we would also allow over CORS.
        if (isAllowedWebOrigin(built, env.webOrigins)) appOrigin = built;
      } else if (fromOrigin && isAllowedWebOrigin(fromOrigin.origin, env.webOrigins)) {
        appOrigin = fromOrigin.origin;
      }

      void this.email
        .sendPasswordResetEmail(
          user.email,
          `${appOrigin}/reset?token=${encodeURIComponent(raw)}`,
        )
        .catch(() => { });
    }
    return { ok: true };
  }

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
export class AuthController {
  constructor(private readonly auth: AuthService) { }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u.userId, u.tenantId);
  }

  @Get("members")
  @UseGuards(JwtAuthGuard)
  members(@CurrentUser() u: AuthUser) {
    return this.auth.listMembers(u.tenantId);
  }

  @Patch("workspace")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner", "admin")
  updateWorkspace(@CurrentUser() u: AuthUser, @Body() body: UpdateWorkspaceDto) {
    return this.auth.updateWorkspace(u.tenantId, body.name);
  }

  @Post("login")
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 300_000 } })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fromHost =
      body.tenantSlug?.trim() ||
      matchTenantHost(String(req.headers.origin ?? ""))?.slug ||
      matchTenantHost(String(req.headers["x-forwarded-host"] ?? ""))?.slug ||
      matchTenantHost(String(req.headers.host ?? ""))?.slug;
    const result = await this.auth.login(body.email, body.password, fromHost);
    setAuthCookies(res, result.token);
    const { token: _token, ...profile } = result;
    return profile;
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) res: Response) {
    clearAuthCookies(res);
    return { ok: true };
  }

  @Post("forgot-password")
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000, blockDuration: 300_000 } })
  forgot(@Body() body: ForgotPasswordDto, @Req() req: Request) {
    const slug =
      body.tenantSlug?.trim() ||
      matchTenantHost(String(req.headers.origin ?? ""))?.slug;
    return this.auth.forgotPassword(
      body.email,
      slug,
      typeof req.headers.origin === "string" ? req.headers.origin : undefined,
    );
  }

  @Post("reset-password")
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 300_000 } })
  reset(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body.token, body.password);
  }
}

@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard],
})
export class AuthModule { }
