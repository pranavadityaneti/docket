import {
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import { users, memberships, tenants } from "@docket/db";
import { DbService } from "../db/db";

export type AuthUser = { userId: string; tenantId: string; role: string };

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
  ) {}

  async login(email: string) {
    const clean = email.trim().toLowerCase();
    const [user] = await this.db.admin.select().from(users).where(eq(users.email, clean)).limit(1);
    if (!user) throw new UnauthorizedException("No account for that email");

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
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  login(@Body() body: { email?: string }) {
    return this.auth.login(body?.email ?? "");
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
