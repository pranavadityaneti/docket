import {
  hashPassword,
  isConfigurablePlatformRole,
  isPlatformRole,
  isTenantSlug,
  memberships,
  normalizeTenantSlug,
  platformAdmins,
  platformRolePrivileges,
  PLATFORM_PRIVILEGES,
  PLATFORM_ROLES,
  privilegesFor,
  provisionTenant,
  ProvisionError,
  sanitizePlatformPrivileges,
  tenants,
  users,
  verifyPassword,
  type ConfigurablePlatformRole,
  type PlatformPrivilege,
  type PlatformRole,
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
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
  SetMetadata,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Throttle } from "@nestjs/throttler";
import {
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Response } from "express";
import { AuthModule, LoginThrottlerGuard } from "../auth/auth";
import {
  clearAdminAuthCookies,
  extractAdminAccessToken,
  setAdminAuthCookies,
} from "../auth/cookies";
import { DbService } from "../db/db";
import {
  STORAGE,
  StorageModule,
  brandingLogoKey,
  type StorageDriver,
} from "../storage/storage";

export type PlatformUser = {
  userId: string;
  role: PlatformRole;
  privileges: PlatformPrivilege[];
};

const PLATFORM_KIND = "platform";
const PLATFORM_PRIVILEGE_KEY = "platform_privilege";
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$6I7QyPRhpNUWqg8thD0S0Q$CmdZjwGsFqTdBRlsUx6TYStwwwZFVFnSuWjooRlaUOY";

const LOGO_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

function logoUpdatedAtOf(branding: Record<string, unknown> | null | undefined): string | null {
  const v = branding?.logoUpdatedAt;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function logoMimeOf(branding: Record<string, unknown> | null | undefined): string | null {
  const v = branding?.logoMimeType;
  return typeof v === "string" && LOGO_MIME.has(v) ? v : null;
}

function displayNameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").replace(/[._+-]+/g, " ").trim();
  return local || email;
}

function RequirePrivilege(privilege: PlatformPrivilege) {
  return SetMetadata(PLATFORM_PRIVILEGE_KEY, privilege);
}

function assertSuperAdmin(user: PlatformUser) {
  if (user.role !== "super_admin") {
    throw new ForbiddenException("Only a super admin can do that");
  }
}

async function privilegesForRole(db: DbService, role: PlatformRole): Promise<PlatformPrivilege[]> {
  if (role === "super_admin") return privilegesFor("super_admin");
  const [row] = await db.admin
    .select({ privileges: platformRolePrivileges.privileges })
    .from(platformRolePrivileges)
    .where(eq(platformRolePrivileges.role, role))
    .limit(1);
  return privilegesFor(role, row?.privileges);
}

export class PlatformLoginDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class PlatformBootstrapDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;
}

export class CreateTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(63)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  plan?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  ownerName!: string;

  @IsEmail()
  @MaxLength(320)
  ownerEmail!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  ownerPassword!: string;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  plan?: string;
}

export class UpdateCredentialsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ValidateIf((o: UpdateCredentialsDto) => o.password !== undefined)
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password?: string;
}

export class CreateOperatorDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;

  @IsIn([...PLATFORM_ROLES])
  role!: PlatformRole;
}

export class UpdateOperatorDto {
  @IsOptional()
  @IsIn([...PLATFORM_ROLES])
  role?: PlatformRole;

  @ValidateIf((o: UpdateOperatorDto) => o.password !== undefined)
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password?: string;
}

export class UpdateRolePrivilegesDto {
  @IsArray()
  @IsString({ each: true })
  privileges!: string[];
}

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractAdminAccessToken(req);
    if (!token) throw new UnauthorizedException("Missing session");
    try {
      const payload = await this.jwt.verifyAsync(token);
      if (payload?.kind !== PLATFORM_KIND || !payload?.sub) {
        throw new UnauthorizedException("Invalid token");
      }
      const [admin] = await this.db.admin
        .select({ id: platformAdmins.id, role: platformAdmins.role })
        .from(platformAdmins)
        .where(eq(platformAdmins.id, payload.sub))
        .limit(1);
      if (!admin || !isPlatformRole(admin.role)) {
        throw new UnauthorizedException("Invalid token");
      }
      req.platformUser = {
        userId: admin.id,
        role: admin.role,
        privileges: await privilegesForRole(this.db, admin.role),
      };
      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException("Invalid token");
    }
  }
}

@Injectable()
export class PlatformPrivilegeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const needed = this.reflector.getAllAndOverride<PlatformPrivilege>(PLATFORM_PRIVILEGE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!needed) return true;
    const user = ctx.switchToHttp().getRequest().platformUser as PlatformUser | undefined;
    if (!user) throw new UnauthorizedException("Missing session");
    if (!user.privileges.includes(needed)) {
      throw new ForbiddenException("You do not have permission to do that");
    }
    return true;
  }
}

export const CurrentPlatformUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformUser =>
    ctx.switchToHttp().getRequest().platformUser,
);

@Injectable()
export class PlatformService {
  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  async needsSetup(): Promise<{ needsSetup: boolean }> {
    const [row] = await this.db.admin
      .select({ n: count() })
      .from(platformAdmins);
    return { needsSetup: Number(row?.n ?? 0) === 0 };
  }

  async bootstrap(input: PlatformBootstrapDto) {
    const email = input.email.trim().toLowerCase();
    const name = displayNameFromEmail(email);

    const passwordHash = await hashPassword(input.password);

    const admin = await this.db.admin.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(872314)`);
      const [existing] = await tx.select({ id: platformAdmins.id }).from(platformAdmins).limit(1);
      if (existing) {
        throw new ConflictException("A platform admin already exists");
      }
      const [created] = await tx
        .insert(platformAdmins)
        .values({ email, name, passwordHash, role: "super_admin" })
        .returning({
          id: platformAdmins.id,
          email: platformAdmins.email,
          name: platformAdmins.name,
          role: platformAdmins.role,
        });
      return created;
    });

    if (!admin) throw new ConflictException("A platform admin already exists");
    return this.issueSession({
      ...admin,
      role: isPlatformRole(admin.role) ? admin.role : "super_admin",
    });
  }

  async login(email: string, password: string) {
    const clean = email.trim().toLowerCase();
    const [admin] = await this.db.admin
      .select()
      .from(platformAdmins)
      .where(eq(platformAdmins.email, clean))
      .limit(1);
    const passwordOk = await verifyPassword(admin?.passwordHash ?? DUMMY_HASH, password);
    if (!admin || !passwordOk) {
      throw new UnauthorizedException("Invalid email or password");
    }
    return this.issueSession({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: isPlatformRole(admin.role) ? admin.role : "super_admin",
    });
  }

  async me(userId: string) {
    const [admin] = await this.db.admin
      .select({
        id: platformAdmins.id,
        name: platformAdmins.name,
        email: platformAdmins.email,
        role: platformAdmins.role,
      })
      .from(platformAdmins)
      .where(eq(platformAdmins.id, userId))
      .limit(1);
    if (!admin || !isPlatformRole(admin.role)) throw new UnauthorizedException("User not found");
    return this.toProfile(admin);
  }

  private async toProfile(admin: { id: string; name: string; email: string; role: PlatformRole }) {
    return {
      user: { id: admin.id, name: admin.name, email: admin.email },
      role: admin.role,
      privileges: await privilegesForRole(this.db, admin.role),
    };
  }

  private async issueSession(admin: {
    id: string;
    email: string;
    name: string;
    role: PlatformRole;
  }) {
    const token = await this.jwt.signAsync({
      sub: admin.id,
      kind: PLATFORM_KIND,
      role: admin.role,
    });
    return {
      token,
      ...(await this.toProfile(admin)),
    };
  }

  private async superAdminCount() {
    const [row] = await this.db.admin
      .select({ n: count() })
      .from(platformAdmins)
      .where(eq(platformAdmins.role, "super_admin"));
    return Number(row?.n ?? 0);
  }

  async listOperators() {
    const rows = await this.db.admin
      .select({
        id: platformAdmins.id,
        name: platformAdmins.name,
        email: platformAdmins.email,
        role: platformAdmins.role,
        createdAt: platformAdmins.createdAt,
      })
      .from(platformAdmins)
      .orderBy(asc(platformAdmins.createdAt));
    return rows.map((r) => ({
      ...r,
      role: (isPlatformRole(r.role) ? r.role : "admin") as PlatformRole,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createOperator(input: CreateOperatorDto, actor: PlatformUser) {
    if (!isPlatformRole(input.role)) throw new BadRequestException("Invalid role");
    if (input.role === "super_admin" && actor.role !== "super_admin") {
      throw new ForbiddenException("Only a super admin can add another super admin");
    }
    const email = input.email.trim().toLowerCase();
    const name = displayNameFromEmail(email);
    const passwordHash = await hashPassword(input.password);
    try {
      const [created] = await this.db.admin
        .insert(platformAdmins)
        .values({ email, name, passwordHash, role: input.role })
        .returning({
          id: platformAdmins.id,
          name: platformAdmins.name,
          email: platformAdmins.email,
          role: platformAdmins.role,
          createdAt: platformAdmins.createdAt,
        });
      if (!created) throw new ConflictException("Could not create that operator");
      return {
        ...created,
        role: (isPlatformRole(created.role) ? created.role : input.role) as PlatformRole,
        createdAt: created.createdAt.toISOString(),
      };
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
      if (code === "23505") throw new ConflictException("That email is already in use");
      throw e;
    }
  }

  async updateOperator(id: string, input: UpdateOperatorDto, actor: PlatformUser) {
    if (!input.role && !input.password) {
      throw new BadRequestException("Nothing to update");
    }
    const [target] = await this.db.admin
      .select({
        id: platformAdmins.id,
        role: platformAdmins.role,
      })
      .from(platformAdmins)
      .where(eq(platformAdmins.id, id))
      .limit(1);
    if (!target) throw new NotFoundException("Operator not found");

    if (actor.role !== "super_admin" && isPlatformRole(target.role) && target.role === "super_admin") {
      throw new ForbiddenException("Only a super admin can change another super admin");
    }

    if (input.role) {
      if (!isPlatformRole(input.role)) throw new BadRequestException("Invalid role");
      if (input.role === "super_admin" && actor.role !== "super_admin") {
        throw new ForbiddenException("Only a super admin can assign that role");
      }
      if (id === actor.userId && input.role !== target.role) {
        throw new BadRequestException("You cannot change your own role");
      }
      if (
        isPlatformRole(target.role) &&
        target.role === "super_admin" &&
        input.role !== "super_admin" &&
        (await this.superAdminCount()) <= 1
      ) {
        throw new ConflictException("Cannot demote the last super admin");
      }
    }

    const patch: { role?: PlatformRole; passwordHash?: string } = {};
    if (input.role) patch.role = input.role;
    if (input.password) patch.passwordHash = await hashPassword(input.password);

    const [row] = await this.db.admin
      .update(platformAdmins)
      .set(patch)
      .where(eq(platformAdmins.id, id))
      .returning({
        id: platformAdmins.id,
        name: platformAdmins.name,
        email: platformAdmins.email,
        role: platformAdmins.role,
        createdAt: platformAdmins.createdAt,
      });
    if (!row) throw new NotFoundException("Operator not found");
    return {
      ...row,
      role: (isPlatformRole(row.role) ? row.role : "admin") as PlatformRole,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async deleteOperator(id: string, actor: PlatformUser) {
    if (id === actor.userId) throw new BadRequestException("You cannot remove yourself");
    const [target] = await this.db.admin
      .select({ id: platformAdmins.id, role: platformAdmins.role })
      .from(platformAdmins)
      .where(eq(platformAdmins.id, id))
      .limit(1);
    if (!target) throw new NotFoundException("Operator not found");
    if (actor.role !== "super_admin" && isPlatformRole(target.role) && target.role === "super_admin") {
      throw new ForbiddenException("Only a super admin can remove another super admin");
    }
    if (isPlatformRole(target.role) && target.role === "super_admin" && (await this.superAdminCount()) <= 1) {
      throw new ConflictException("Cannot remove the last super admin");
    }
    const [row] = await this.db.admin
      .delete(platformAdmins)
      .where(eq(platformAdmins.id, id))
      .returning({ id: platformAdmins.id, email: platformAdmins.email });
    if (!row) throw new NotFoundException("Operator not found");
    return { ok: true as const, id: row.id, email: row.email };
  }

  async listRolePrivileges() {
    const rows = await this.db.admin
      .select({
        role: platformRolePrivileges.role,
        privileges: platformRolePrivileges.privileges,
      })
      .from(platformRolePrivileges);
    const stored = new Map(
      rows.map((r) => [r.role, privilegesFor(r.role as PlatformRole, r.privileges)]),
    );
    return {
      privileges: [...PLATFORM_PRIVILEGES],
      roles: PLATFORM_ROLES.map((role) => ({
        role,
        locked: role === "super_admin",
        privileges:
          role === "super_admin"
            ? [...PLATFORM_PRIVILEGES]
            : (stored.get(role) ?? privilegesFor(role)),
      })),
    };
  }

  async updateRolePrivileges(role: string, privileges: string[]) {
    if (!isConfigurablePlatformRole(role)) {
      throw new BadRequestException("Only Admin and Sub-admin permissions can be changed");
    }
    const clean = sanitizePlatformPrivileges(privileges);
    const [row] = await this.db.admin
      .insert(platformRolePrivileges)
      .values({
        role,
        privileges: clean,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: platformRolePrivileges.role,
        set: { privileges: clean, updatedAt: new Date() },
      })
      .returning({
        role: platformRolePrivileges.role,
        privileges: platformRolePrivileges.privileges,
      });
    if (!row) throw new ConflictException("Could not save those permissions");
    const nextRole = row.role as ConfigurablePlatformRole;
    return {
      role: nextRole,
      locked: false,
      privileges: privilegesFor(nextRole, row.privileges),
    };
  }

  async overview() {
    const [totals] = await this.db.admin
      .select({ n: count() })
      .from(tenants);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [recent] = await this.db.admin
      .select({ n: count() })
      .from(tenants)
      .where(gte(tenants.createdAt, weekAgo));
    return {
      tenantCount: Number(totals?.n ?? 0),
      tenantsCreatedThisWeek: Number(recent?.n ?? 0),
    };
  }

  async listTenants() {
    const rows = await this.db.admin
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        plan: tenants.plan,
        createdAt: tenants.createdAt,
        branding: tenants.branding,
      })
      .from(tenants)
      .orderBy(asc(tenants.name));

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const owners = await this.db.admin
      .select({
        tenantId: memberships.tenantId,
        name: users.name,
        email: users.email,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.role, "owner"), inArray(memberships.tenantId, ids)))
      .orderBy(asc(memberships.createdAt));

    const ownerByTenant = new Map<string, { name: string; email: string }>();
    for (const o of owners) {
      if (!ownerByTenant.has(o.tenantId)) {
        ownerByTenant.set(o.tenantId, { name: o.name, email: o.email });
      }
    }

    const counts = await this.db.admin
      .select({ tenantId: memberships.tenantId, n: count() })
      .from(memberships)
      .where(inArray(memberships.tenantId, ids))
      .groupBy(memberships.tenantId);
    const countByTenant = new Map(counts.map((c) => [c.tenantId, Number(c.n)]));

    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      plan: t.plan,
      createdAt: t.createdAt.toISOString(),
      logoUpdatedAt: logoUpdatedAtOf(t.branding),
      owner: ownerByTenant.get(t.id) ?? null,
      memberCount: countByTenant.get(t.id) ?? 0,
    }));
  }

  async getTenant(id: string) {
    const [tenant] = await this.db.admin
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        plan: tenants.plan,
        createdAt: tenants.createdAt,
        branding: tenants.branding,
      })
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);
    if (!tenant) throw new NotFoundException("Workspace not found");

    const members = await this.db.admin
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, id))
      .orderBy(desc(memberships.role), asc(users.name));

    const owner = members.find((m) => m.role === "owner") ?? members[0] ?? null;
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      createdAt: tenant.createdAt.toISOString(),
      logoUpdatedAt: logoUpdatedAtOf(tenant.branding),
      owner: owner
        ? { id: owner.id, name: owner.name, email: owner.email, role: owner.role }
        : null,
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async getTenantLogo(id: string): Promise<{ body: Buffer; mimeType: string }> {
    const [row] = await this.db.admin
      .select({ branding: tenants.branding })
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);
    if (!row) throw new NotFoundException("Workspace not found");
    if (!logoUpdatedAtOf(row.branding)) throw new NotFoundException("No logo uploaded");
    const mime = logoMimeOf(row.branding) ?? "image/png";
    try {
      const body = await this.storage.get(brandingLogoKey(id));
      return { body, mimeType: mime };
    } catch {
      throw new NotFoundException("No logo uploaded");
    }
  }

  async createTenant(input: CreateTenantDto) {
    const slug = normalizeTenantSlug(input.slug);
    if (!isTenantSlug(slug)) {
      throw new BadRequestException(
        "Slug must be 1–63 lowercase letters or digits, with hyphens in between",
      );
    }
    try {
      return await provisionTenant(this.db.admin, {
        name: input.name,
        slug,
        plan: input.plan,
        ownerName: input.ownerName,
        ownerEmail: input.ownerEmail,
        ownerPassword: input.ownerPassword,
      });
    } catch (e) {
      if (e instanceof ProvisionError) {
        if (e.code === "conflict") throw new ConflictException(e.message);
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }

  async updateTenant(id: string, input: UpdateTenantDto) {
    const patch: { name?: string; plan?: string } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException("Workspace name is required");
      patch.name = name;
    }
    if (input.plan !== undefined) {
      const plan = input.plan.trim().toLowerCase();
      if (!plan) throw new BadRequestException("Plan is required");
      patch.plan = plan;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException("Nothing to update");
    }
    const [row] = await this.db.admin
      .update(tenants)
      .set(patch)
      .where(eq(tenants.id, id))
      .returning({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        plan: tenants.plan,
      });
    if (!row) throw new NotFoundException("Workspace not found");
    return row;
  }

  async updateCredentials(tenantId: string, input: UpdateCredentialsDto) {
    if (!input.name && !input.email && !input.password) {
      throw new BadRequestException("Nothing to update");
    }
    const detail = await this.getTenant(tenantId);
    if (!detail.owner) {
      throw new BadRequestException("This workspace has no owner to update");
    }

    const patch: { name?: string; email?: string; passwordHash?: string } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException("Owner name is required");
      patch.name = name;
    }
    if (input.email !== undefined) {
      patch.email = input.email.trim().toLowerCase();
    }
    if (input.password) {
      patch.passwordHash = await hashPassword(input.password);
    }

    try {
      const [row] = await this.db.admin
        .update(users)
        .set(patch)
        .where(eq(users.id, detail.owner.id))
        .returning({ id: users.id, name: users.name, email: users.email });
      if (!row) throw new NotFoundException("Owner not found");
      return { owner: row, passwordSet: Boolean(input.password) };
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
      if (code === "23505") {
        throw new ConflictException("That email is already in use");
      }
      throw e;
    }
  }

  async deleteTenant(id: string) {
    const [row] = await this.db.admin
      .delete(tenants)
      .where(eq(tenants.id, id))
      .returning({ id: tenants.id, slug: tenants.slug });
    if (!row) throw new NotFoundException("Workspace not found");
    return { ok: true as const, id: row.id, slug: row.slug };
  }
}

@Controller("platform/auth")
export class PlatformAuthController {
  constructor(private readonly platform: PlatformService) {}

  @Get("status")
  status() {
    return this.platform.needsSetup();
  }

  @Post("bootstrap")
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000, blockDuration: 300_000 } })
  async bootstrap(
    @Body() body: PlatformBootstrapDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.platform.bootstrap(body);
    setAdminAuthCookies(res, result.token);
    const { token: _token, ...profile } = result;
    return profile;
  }

  @Post("login")
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 300_000 } })
  async login(
    @Body() body: PlatformLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.platform.login(body.email, body.password);
    setAdminAuthCookies(res, result.token);
    const { token: _token, ...profile } = result;
    return profile;
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) res: Response) {
    clearAdminAuthCookies(res);
    return { ok: true };
  }

  @Get("me")
  @UseGuards(PlatformAuthGuard)
  me(@CurrentPlatformUser() u: PlatformUser) {
    return this.platform.me(u.userId);
  }
}

@Controller("platform/tenants")
@UseGuards(PlatformAuthGuard, PlatformPrivilegeGuard)
@RequirePrivilege("tenants.read")
export class PlatformTenantsController {
  constructor(private readonly platform: PlatformService) {}

  @Get("overview")
  overview() {
    return this.platform.overview();
  }

  @Get()
  list() {
    return this.platform.listTenants();
  }

  @Post()
  @RequirePrivilege("tenants.write")
  create(@Body() body: CreateTenantDto) {
    return this.platform.createTenant(body);
  }

  @Get(":id/logo")
  async logo(
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, mimeType } = await this.platform.getTenantLogo(id);
    res.setHeader("content-type", mimeType);
    res.setHeader("cache-control", "private, max-age=3600");
    return new StreamableFile(body);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.platform.getTenant(id);
  }

  @Patch(":id")
  @RequirePrivilege("tenants.write")
  update(@Param("id") id: string, @Body() body: UpdateTenantDto) {
    return this.platform.updateTenant(id, body);
  }

  @Patch(":id/credentials")
  @RequirePrivilege("tenants.credentials")
  credentials(@Param("id") id: string, @Body() body: UpdateCredentialsDto) {
    return this.platform.updateCredentials(id, body);
  }

  @Delete(":id")
  @RequirePrivilege("tenants.delete")
  remove(@Param("id") id: string) {
    return this.platform.deleteTenant(id);
  }
}

@Controller("platform/operators")
@UseGuards(PlatformAuthGuard, PlatformPrivilegeGuard)
@RequirePrivilege("operators.read")
export class PlatformOperatorsController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  list() {
    return this.platform.listOperators();
  }

  @Post()
  @RequirePrivilege("operators.write")
  create(@Body() body: CreateOperatorDto, @CurrentPlatformUser() u: PlatformUser) {
    return this.platform.createOperator(body, u);
  }

  @Patch(":id")
  @RequirePrivilege("operators.write")
  update(
    @Param("id") id: string,
    @Body() body: UpdateOperatorDto,
    @CurrentPlatformUser() u: PlatformUser,
  ) {
    return this.platform.updateOperator(id, body, u);
  }

  @Delete(":id")
  @RequirePrivilege("operators.write")
  remove(@Param("id") id: string, @CurrentPlatformUser() u: PlatformUser) {
    return this.platform.deleteOperator(id, u);
  }
}

@Controller("platform/roles")
@UseGuards(PlatformAuthGuard)
export class PlatformRolesController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  list(@CurrentPlatformUser() u: PlatformUser) {
    assertSuperAdmin(u);
    return this.platform.listRolePrivileges();
  }

  @Put(":role")
  update(
    @CurrentPlatformUser() u: PlatformUser,
    @Param("role") role: string,
    @Body() body: UpdateRolePrivilegesDto,
  ) {
    assertSuperAdmin(u);
    return this.platform.updateRolePrivileges(role, body.privileges);
  }
}

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [PlatformAuthController, PlatformTenantsController, PlatformOperatorsController, PlatformRolesController],
  providers: [PlatformService, PlatformAuthGuard, PlatformPrivilegeGuard],
})
export class PlatformModule {}
