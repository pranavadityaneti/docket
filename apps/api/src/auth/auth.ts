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
  ConflictException,
  Controller,
  createParamDecorator,
  Delete,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
  SetMetadata,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import type { Request, Response } from "express";
import { env } from "../config/env";
import { isAllowedWebOrigin, matchTenantHost, originForSlug } from "../config/tenant-host";
import { DbService } from "../db/db";
import { EmailModule, EmailService } from "../email/email";
import {
  brandingLogoKey,
  STORAGE,
  StorageModule,
  type StorageDriver,
} from "../storage/storage";
import { clearAuthCookies, extractAccessToken, setAuthCookies } from "./cookies";
import {
  MEMBER_TITLE_MAX,
  memberMutationError,
  normalizeMemberTitle,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from "./team";

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

const WORKSPACE_ROLE_VALUES = [...WORKSPACE_ROLES];

export class AddMemberDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsIn(WORKSPACE_ROLE_VALUES)
  role!: WorkspaceRole;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MEMBER_TITLE_MAX)
  title?: string;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(WORKSPACE_ROLE_VALUES)
  role?: WorkspaceRole;

  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MEMBER_TITLE_MAX)
  title?: string;
}

const LOGO_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

type TenantBranding = Record<string, unknown>;

function logoUpdatedAtOf(branding: TenantBranding | null | undefined): string | null {
  const v = branding?.logoUpdatedAt;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function logoMimeOf(branding: TenantBranding | null | undefined): string | null {
  const v = branding?.logoMimeType;
  return typeof v === "string" && LOGO_MIME.has(v) ? v : null;
}

function shapeTenant(row: {
  id: string;
  name: string;
  slug: string;
  branding?: TenantBranding | null;
}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUpdatedAt: logoUpdatedAtOf(row.branding),
  };
}

async function readLimitedBody(req: Request, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).byteLength;
    if (total > maxBytes) {
      throw new BadRequestException(
        `Logo must be ${Math.floor(maxBytes / 1024 / 1024)}MB or smaller`,
      );
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
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
      if (payload?.kind === "platform" || !payload?.tenantId || !payload?.sub) {
        throw new UnauthorizedException("Invalid token");
      }
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
    @Inject(STORAGE) private readonly storage: StorageDriver,
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
    let tenant: { id: string; name: string; slug: string; logoUpdatedAt: string | null } | undefined;

    if (slug) {
      const [row] = await this.db.admin
        .select({
          tenantId: memberships.tenantId,
          role: memberships.role,
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          branding: tenants.branding,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.userId, user.id), eq(tenants.slug, slug)))
        .limit(1);
      if (!row) {
        throw new UnauthorizedException("No access to this workspace");
      }
      membership = { tenantId: row.tenantId, role: row.role };
      tenant = shapeTenant({ id: row.id, name: row.name, slug: row.slug, branding: row.branding });
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
      tenant = shapeTenant(t);
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
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        branding: tenants.branding,
      })
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
    return { user, tenant: shapeTenant(tenant), role: m.role };
  }

  /** Workspace members - for case owner assignment and the Team screen. */
  async listMembers(tenantId: string) {
    const rows = await this.db.admin
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
        title: memberships.title,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.tenantId, tenantId))
      .orderBy(asc(users.name));
    return rows.map((r) => this.shapeMember(r));
  }

  private async ownerCount(tenantId: string): Promise<number> {
    const [row] = await this.db.admin
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "owner")));
    return Number(row?.n ?? 0);
  }

  private denyMemberMutation(error: string | null): void {
    if (!error) return;
    if (error.startsWith("Only workspace")) throw new ForbiddenException(error);
    if (error === "Member not found") throw new NotFoundException(error);
    if (error.startsWith("Cannot ") || error.includes("already")) {
      throw new ConflictException(error);
    }
    throw new BadRequestException(error);
  }

  private shapeMember(row: {
    id: string;
    name: string;
    email: string;
    role: string;
    title: string | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async addMember(
    actor: AuthUser,
    input: { email: string; name: string; role: WorkspaceRole; password: string; title?: string },
  ) {
    this.denyMemberMutation(
      memberMutationError({
        actorRole: actor.role,
        actorUserId: actor.userId,
        nextRole: input.role,
        kind: "add",
        ownerCount: 0,
      }),
    );

    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Name is required");
    const passwordHash = await hashPassword(input.password);

    const [existing] = await this.db.admin
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let userId: string;
    let displayName = name;
    if (existing) {
      const [already] = await this.db.admin
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, existing.id), eq(memberships.tenantId, actor.tenantId)))
        .limit(1);
      if (already) throw new ConflictException("That person is already in this workspace");
      userId = existing.id;
      displayName = existing.name;
      if (existing.passwordHash === null) {
        await this.db.admin
          .update(users)
          .set({ passwordHash, name: existing.name || name })
          .where(eq(users.id, existing.id));
      }
    } else {
      try {
        const [created] = await this.db.admin
          .insert(users)
          .values({ email, name, passwordHash })
          .returning({ id: users.id, name: users.name });
        if (!created) throw new ConflictException("Could not create that user");
        userId = created.id;
        displayName = created.name;
      } catch (e: unknown) {
        const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
        if (code === "23505") throw new ConflictException("That email is already in use");
        throw e;
      }
    }

    try {
      const [membership] = await this.db.admin
        .insert(memberships)
        .values({
          userId,
          tenantId: actor.tenantId,
          role: input.role,
          title: normalizeMemberTitle(input.title),
        })
        .returning({
          role: memberships.role,
          title: memberships.title,
          createdAt: memberships.createdAt,
        });
      if (!membership) throw new ConflictException("Could not add that member");

      return this.shapeMember({
        id: userId,
        name: displayName,
        email,
        role: membership.role,
        title: membership.title,
        createdAt: membership.createdAt,
      });
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
      if (code === "23505") throw new ConflictException("That person is already in this workspace");
      throw e;
    }
  }

  async updateMember(
    actor: AuthUser,
    userId: string,
    input: { name?: string; role?: WorkspaceRole; password?: string; title?: string },
  ) {
    const name = input.name?.trim();
    const titleProvided = typeof input.title === "string";
    if (!name && !input.role && !input.password && !titleProvided) {
      throw new BadRequestException("Nothing to update");
    }

    const [target] = await this.db.admin
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
        title: memberships.title,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, actor.tenantId)))
      .limit(1);
    if (!target) throw new NotFoundException("Member not found");

    const owners = await this.ownerCount(actor.tenantId);

    if (input.role && input.role !== target.role) {
      this.denyMemberMutation(
        memberMutationError({
          actorRole: actor.role,
          actorUserId: actor.userId,
          targetUserId: userId,
          targetRole: target.role,
          nextRole: input.role,
          kind: "role",
          ownerCount: owners,
        }),
      );
    }
    if (input.password) {
      this.denyMemberMutation(
        memberMutationError({
          actorRole: actor.role,
          actorUserId: actor.userId,
          targetUserId: userId,
          targetRole: target.role,
          kind: "password",
          ownerCount: owners,
        }),
      );
    }

    if (name) {
      await this.db.admin.update(users).set({ name }).where(eq(users.id, userId));
    }
    if (input.password) {
      await this.db.admin
        .update(users)
        .set({ passwordHash: await hashPassword(input.password) })
        .where(eq(users.id, userId));
    }
    if (input.role && input.role !== target.role) {
      await this.db.admin
        .update(memberships)
        .set({ role: input.role })
        .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, actor.tenantId)));
    }
    if (titleProvided) {
      await this.db.admin
        .update(memberships)
        .set({ title: normalizeMemberTitle(input.title) })
        .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, actor.tenantId)));
    }

    const [row] = await this.db.admin
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
        title: memberships.title,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, actor.tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException("Member not found");
    return this.shapeMember(row);
  }

  async removeMember(actor: AuthUser, userId: string) {
    const [target] = await this.db.admin
      .select({
        id: users.id,
        role: memberships.role,
        email: users.email,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, actor.tenantId)))
      .limit(1);
    if (!target) throw new NotFoundException("Member not found");

    this.denyMemberMutation(
      memberMutationError({
        actorRole: actor.role,
        actorUserId: actor.userId,
        targetUserId: userId,
        targetRole: target.role,
        kind: "remove",
        ownerCount: await this.ownerCount(actor.tenantId),
      }),
    );

    await this.db.admin
      .delete(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, actor.tenantId)));

    return { ok: true as const, id: target.id, email: target.email };
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
      .returning({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        branding: tenants.branding,
      });
    if (!row) throw new NotFoundException("Workspace not found");
    return shapeTenant(row);
  }

  private async loadTenant(tenantId: string) {
    const [row] = await this.db.admin
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        branding: tenants.branding,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!row) throw new NotFoundException("Workspace not found");
    return row;
  }

  async putWorkspaceLogo(tenantId: string, body: Buffer, contentType: string) {
    const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!LOGO_MIME.has(mime)) {
      throw new BadRequestException("Logo must be a PNG, JPEG, or WebP image");
    }
    if (body.byteLength === 0) throw new BadRequestException("Logo file is empty");
    const current = await this.loadTenant(tenantId);
    await this.storage.put(brandingLogoKey(tenantId), body, mime);
    const branding = {
      ...(current.branding ?? {}),
      logoMimeType: mime,
      logoUpdatedAt: new Date().toISOString(),
    };
    const [row] = await this.db.admin
      .update(tenants)
      .set({ branding })
      .where(eq(tenants.id, tenantId))
      .returning({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        branding: tenants.branding,
      });
    if (!row) throw new NotFoundException("Workspace not found");
    return shapeTenant(row);
  }

  async getWorkspaceLogo(tenantId: string): Promise<{ body: Buffer; mimeType: string }> {
    const row = await this.loadTenant(tenantId);
    if (!logoUpdatedAtOf(row.branding)) {
      throw new NotFoundException("No logo uploaded");
    }
    const mime = logoMimeOf(row.branding) ?? "image/png";
    try {
      const body = await this.storage.get(brandingLogoKey(tenantId));
      return { body, mimeType: mime };
    } catch {
      throw new NotFoundException("No logo uploaded");
    }
  }

  async deleteWorkspaceLogo(tenantId: string) {
    const current = await this.loadTenant(tenantId);
    await this.storage.delete(brandingLogoKey(tenantId));
    const branding = { ...(current.branding ?? {}) };
    delete branding.logoMimeType;
    delete branding.logoUpdatedAt;
    const [row] = await this.db.admin
      .update(tenants)
      .set({ branding })
      .where(eq(tenants.id, tenantId))
      .returning({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        branding: tenants.branding,
      });
    if (!row) throw new NotFoundException("Workspace not found");
    return shapeTenant(row);
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

  @Post("members")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner", "admin")
  addMember(@CurrentUser() u: AuthUser, @Body() body: AddMemberDto) {
    return this.auth.addMember(u, body);
  }

  @Patch("members/:userId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner", "admin")
  updateMember(
    @CurrentUser() u: AuthUser,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() body: UpdateMemberDto,
  ) {
    return this.auth.updateMember(u, userId, body);
  }

  @Delete("members/:userId")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner", "admin")
  removeMember(
    @CurrentUser() u: AuthUser,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    return this.auth.removeMember(u, userId);
  }

  @Patch("workspace")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner", "admin")
  updateWorkspace(@CurrentUser() u: AuthUser, @Body() body: UpdateWorkspaceDto) {
    return this.auth.updateWorkspace(u.tenantId, body.name);
  }

  @Get("workspace/logo")
  @UseGuards(JwtAuthGuard)
  async workspaceLogo(
    @CurrentUser() u: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, mimeType } = await this.auth.getWorkspaceLogo(u.tenantId);
    res.setHeader("content-type", mimeType);
    res.setHeader("cache-control", "private, max-age=3600");
    return new StreamableFile(body);
  }

  @Put("workspace/logo")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner", "admin")
  async putWorkspaceLogo(@CurrentUser() u: AuthUser, @Req() req: Request) {
    const contentType = String(req.headers["content-type"] ?? "");
    const body = await readLimitedBody(req, LOGO_MAX_BYTES);
    return this.auth.putWorkspaceLogo(u.tenantId, body, contentType);
  }

  @Delete("workspace/logo")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner", "admin")
  deleteWorkspaceLogo(@CurrentUser() u: AuthUser) {
    return this.auth.deleteWorkspaceLogo(u.tenantId);
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
  imports: [EmailModule, StorageModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, LoginThrottlerGuard],
  exports: [JwtAuthGuard, RolesGuard, LoginThrottlerGuard],
})
export class AuthModule { }
