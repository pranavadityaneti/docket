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
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { eq } from "drizzle-orm";
import { users, memberships, tenants, verifyPassword } from "@docket/db";
import { DbService } from "../db/db";

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

// Hash of an arbitrary, never-used string — not a real credential. Verified
// against on every login where the real user/hash lookup misses, so argon2's
// (deliberately costly) computation runs on every attempt regardless of
// whether the account exists. Without this, an unknown-email or
// no-password-set request short-circuits before hashing while a wrong
// password on a real account does not — a timing side-channel that lets an
// attacker enumerate valid emails even though the error message is identical.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$6I7QyPRhpNUWqg8thD0S0Q$CmdZjwGsFqTdBRlsUx6TYStwwwZFVFnSuWjooRlaUOY";

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
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  login(@Body() body: LoginDto) {
    // email/password presence + format are enforced by the global ValidationPipe.
    return this.auth.login(body.email, body.password);
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
