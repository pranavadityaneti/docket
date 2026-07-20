# Forgot-password Flow — Implementation Plan

> **For agentic workers:** built one change at a time. Each **Task** is a coherent, `tsc`-clean unit ending in a commit and a STOP for review (per the project's workflow). Steps use `- [ ]`.

**Goal:** Let a locked-out user reset their password via an emailed single-use link, replacing the manual operator reset.

**Architecture:** A global `password_reset_tokens` table (per-user, no tenant RLS, owner-accessed like `login`). Two throttled pre-auth endpoints on the existing auth controller. A Resend email module that no-ops without keys. Two web pages (`/forgot`, `/reset`) plus a login link.

**Tech Stack:** NestJS, drizzle/postgres-js, argon2 (existing), sha256 (node crypto), Resend, Next.js.

**Verification note:** Docket has **no test runner or test files**; all verification this project uses is `tsc --noEmit` + `next build` + exercising the real API/UI. This plan follows that — it does **not** fabricate a jest/pytest harness. Standing up a test framework is a separate, out-of-scope decision (flagged as a follow-up). Security-critical behaviour (single-use, expiry, enumeration parity) is verified by driving the real endpoints with `curl` against the local API + DB.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `packages/db/src/reset-token.ts` | create | generate/hash reset tokens (sha256) |
| `packages/db/src/schema.ts` | modify | `passwordResetTokens` table |
| `packages/db/src/index.ts` | modify | export reset-token helpers |
| `packages/db/migrations/0009_password_reset_tokens.sql` | create | table + indexes + revoke from app role |
| `packages/db/migrations/meta/_journal.json` | modify | journal entry for 0009 |
| `apps/api/package.json` | modify | add `resend` dep |
| `apps/api/src/email/email.ts` | create | `EmailService` + `EmailModule` (Resend wrapper) |
| `apps/api/src/config/env.ts` | modify | `resendApiKey`, `resendFromEmail`, `appOrigin` |
| `apps/api/src/config/secrets.ts` | modify | allow `RESEND_*` from Secrets Manager |
| `apps/api/src/auth/auth.ts` | modify | 2 DTOs, 2 service methods, 2 routes, inject EmailService, import EmailModule |
| `apps/web/lib/api.ts` | modify | `requestPasswordReset`, `resetPassword` |
| `apps/web/app/forgot/page.tsx` | create | request-reset page |
| `apps/web/app/reset/page.tsx` | create | set-new-password page |
| `apps/web/app/login/page.tsx` | modify | "Forgot password?" link + `?reset=1` notice |

---

## Task 1 — DB layer (token helper, table, migration)

**Files:** create `packages/db/src/reset-token.ts`; modify `packages/db/src/schema.ts`, `packages/db/src/index.ts`; create `packages/db/migrations/0009_password_reset_tokens.sql`; modify `packages/db/migrations/meta/_journal.json`.

- [ ] **1.1 — reset-token helper.** Create `packages/db/src/reset-token.ts`:

```ts
import { randomBytes, createHash } from "node:crypto";

/**
 * A password-reset token: a high-entropy random value the user receives by
 * email, and the sha256 of it that we store. sha256 (not argon2) is correct
 * here — the token already carries 256 bits of entropy, so a slow hash buys
 * nothing against a value that cannot be guessed. Passwords use argon2 because
 * they are low-entropy; tokens are not.
 */
export function generateResetToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashResetToken(raw) };
}

export function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
```

- [ ] **1.2 — export it.** In `packages/db/src/index.ts` add: `export * from "./reset-token";`

- [ ] **1.3 — schema table.** In `packages/db/src/schema.ts`, after the `memberships` table (identity cluster), add:

```ts
/**
 * One-time password-reset tokens. GLOBAL (per-user), not tenant-scoped: a reset
 * is about a person, who may belong to several tenants. Reached only via the
 * owner role in the pre-auth flow, exactly as `login` reads `users`. No
 * tenant_id and no RLS — see the migration, which also revokes the app role's
 * auto-granted access so the tenant-scoped role can never read tokens.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("password_reset_tokens_token_hash_idx").on(t.tokenHash),
    index("password_reset_tokens_user_idx").on(t.userId),
  ],
);
```

- [ ] **1.4 — migration.** Create `packages/db/migrations/0009_password_reset_tokens.sql`:

```sql
-- Password-reset tokens — global (per-user), not tenant-scoped. Reached only via
-- the owner role in the pre-auth flow, exactly as login reads users. No
-- tenant_id, no RLS.
CREATE TABLE "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" ("user_id");--> statement-breakpoint
-- New tables inherit ALTER DEFAULT PRIVILEGES grants to the tenant-scoped app
-- role, and with no tenant_id there is no RLS policy to isolate by. These tokens
-- are pre-auth and global, touched only by the owner role — so close the door
-- the default grant opens rather than leave the app role able to read every
-- user's tokens.
REVOKE ALL ON "password_reset_tokens" FROM "docket_app";
```

- [ ] **1.5 — journal entry.** Append to `packages/db/migrations/meta/_journal.json` a new entry: `idx` = previous + 1, `version` "7", `when` = a millisecond value greater than the 0008 entry's `when`, `tag` "0009_password_reset_tokens", `breakpoints` true.

- [ ] **1.6 — verify.** Run:
```
cd packages/db && npx tsc --noEmit          # clean
pnpm --filter @docket/db build              # compiles
DATABASE_URL=postgres://pranavaditya@localhost:5432/docket pnpm --filter @docket/db migrate
psql -d docket -c "\d password_reset_tokens"   # table + 2 indexes present
psql -d docket -c "\dp password_reset_tokens"  # docket_app has NO privileges
```
Expected: table with the 6 columns + both indexes; `docket_app` absent from the access-privileges grantee list.

- [ ] **1.7 — commit** `feat(db): password_reset_tokens table + token helper`. **STOP for review.**

---

## Task 2 — Email module + config

**Files:** modify `apps/api/package.json`; create `apps/api/src/email/email.ts`; modify `apps/api/src/config/env.ts`, `apps/api/src/config/secrets.ts`.

- [ ] **2.1 — add dep.** In `apps/api/package.json` dependencies add `"resend": "^6.17.2"` (same major as Finlot's), then `pnpm install`.

- [ ] **2.2 — email module.** Create `apps/api/src/email/email.ts`:

```ts
import { Injectable, Logger, Module } from "@nestjs/common";
import { Resend } from "resend";
import { env } from "../config/env";

/**
 * Transactional email via Resend. If the API key or from-address is unset it
 * logs and no-ops, so local dev and tests run with no email credentials — the
 * same posture as config/secrets hydration. Reuses the Resend account and
 * verified domain the marketing site already sends from.
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private readonly resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    if (!this.resend || !env.resendFromEmail) {
      this.log.warn(`Resend not configured — skipping password-reset email to ${to}`);
      return;
    }
    const { error } = await this.resend.emails.send({
      from: env.resendFromEmail,
      to,
      subject: "Reset your Docket password",
      text:
        `Someone asked to reset the password for this Docket account.\n\n` +
        `Reset it here (the link expires in 1 hour):\n${resetUrl}\n\n` +
        `If you didn't ask for this, ignore this email — your password stays the same.`,
    });
    // Logged, never thrown: the caller must return the same response whether or
    // not the account exists, so a send failure must not surface to the user.
    if (error) this.log.error(`Password-reset email to ${to} failed: ${error.message ?? error}`);
  }
}

@Module({ providers: [EmailService], exports: [EmailService] })
export class EmailModule {}
```

- [ ] **2.3 — env.** In `apps/api/src/config/env.ts`, read the existing `webOrigins` array, and add to the exported `env` object:
```ts
resendApiKey: process.env.RESEND_API_KEY?.trim() || undefined,
resendFromEmail: process.env.RESEND_FROM_EMAIL?.trim() || undefined,
// Canonical app origin for links in emails. First WEB_ORIGIN entry in prod;
// localhost in dev where WEB_ORIGIN is unset. Never taken from request input.
appOrigin: webOrigins[0] ?? "http://localhost:3000",
```
(If `webOrigins` is declared after the object, hoist the two lines that compute it above the object, or reference `process.env.WEB_ORIGIN` split inline — match the file's actual structure.)

- [ ] **2.4 — secrets allow-list.** In `apps/api/src/config/secrets.ts`, extend `ALLOWED`:
```ts
const ALLOWED = new Set(["DATABASE_URL", "JWT_SECRET", "RESEND_API_KEY", "RESEND_FROM_EMAIL"]);
```

- [ ] **2.5 — verify.** `cd apps/api && npx tsc --noEmit` → clean.

- [ ] **2.6 — commit** `feat(api): Resend email module + config`. **STOP for review.**

---

## Task 3 — Auth endpoints

**Files:** modify `apps/api/src/auth/auth.ts`.

- [ ] **3.1 — imports.** Add `BadRequestException` to the `@nestjs/common` import; add `and, gt, isNull` to the `drizzle-orm` import; extend the `@docket/db` import with `passwordResetTokens, hashPassword, generateResetToken`; import `EmailModule, EmailService` from `../email/email`; import `env` from `../config/env`.

- [ ] **3.2 — DTOs.** After `LoginDto`:
```ts
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

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;
}
```

- [ ] **3.3 — inject EmailService.** In `AuthService` constructor add `private readonly email: EmailService,`.

- [ ] **3.4 — service methods.** Add to `AuthService`:
```ts
/**
 * Start a reset. ALWAYS resolves to { ok: true } — the caller cannot tell
 * whether the email exists (no enumeration), mirroring login's dummy-hash
 * posture. If it does exist, prior unused tokens are superseded, a new one is
 * issued, and the link is emailed; a send failure is swallowed (logged in the
 * email module) so it can never reveal the account.
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
```
(Import `hashResetToken` too in 3.1 — add it to the `@docket/db` import.)

- [ ] **3.5 — routes.** Add to `AuthController`:
```ts
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
```

- [ ] **3.6 — throttler null-safety.** `AuthController` is `@UseGuards(LoginThrottlerGuard)`, whose `getTracker` reads `req.body.email`. `reset-password` has no email. Read the full `getTracker` method; if it can throw on an absent/undefined email (e.g. `.trim()` on undefined), make it null-safe (fall back to IP-only tracking when email is missing). Confirm by inspection.

- [ ] **3.7 — wire module.** Add `imports: [EmailModule],` to the `AuthModule` decorator.

- [ ] **3.8 — verify (tsc + real endpoints).**
```
cd apps/api && npx tsc --noEmit    # clean
# start API locally (DATABASE_URL, JWT_SECRET, STORAGE_DRIVER=local); no RESEND keys → email no-ops
```
Then exercise with `curl` against `localhost:3333` and check the DB:
  1. `POST /auth/forgot-password {email: admin@finlot.ai}` → `200 {ok:true}`; a row appears in `password_reset_tokens`; API log shows the "Resend not configured — skipping" warning.
  2. `POST /auth/forgot-password {email: nobody@nowhere.tld}` → `200 {ok:true}`, identical body, **no** new row (enumeration parity).
  3. Take the token: since email no-ops, read the raw token by temporarily logging it, OR generate one via `node -e` using `generateResetToken()` and insert it directly for the test. Reset with it → `200`; login with the new password works; the token row now has `used_at` set.
  4. Reuse the same token → `400`. Use an expired token (insert one with past `expires_at`) → `400`.
  5. A second `forgot-password` for the same user marks the first token `used_at` (superseded).
Clean up any test rows/passwords afterward (this is the local dev DB).

- [ ] **3.9 — commit** `feat(api): forgot-password + reset-password endpoints`. **STOP for review.**

---

## Task 4 — Frontend

**Files:** modify `apps/web/lib/api.ts`; create `apps/web/app/forgot/page.tsx`, `apps/web/app/reset/page.tsx`; modify `apps/web/app/login/page.tsx`.

- [ ] **4.1 — client fns.** In `apps/web/lib/api.ts`, add (pre-auth, raw `fetch` like `login`, no Bearer):
```ts
/** POST /auth/forgot-password — always resolves ok; never reveals if the email exists. */
export async function requestPasswordReset(email: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
}

/** POST /auth/reset-password — 400 if the link is invalid/expired. */
export async function resetPassword(token: string, password: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Reset failed (${res.status})`);
  }
}
```

- [ ] **4.2 — `/forgot` page.** Create `apps/web/app/forgot/page.tsx` (client component; reuse the login page's card/input/button styling). One email input; on submit call `requestPasswordReset`, then **always** show the neutral notice *"If that email is registered, we've sent a reset link. Check your inbox."* (show it even on a thrown network error only if the request completed; on real network failure show a retry message). A "Back to sign in" link to `/login`.

- [ ] **4.3 — `/reset` page.** Create `apps/web/app/reset/page.tsx` (client component). Read `token` from `useSearchParams` (wrap in `<Suspense>` like the cases page does). Password + confirm fields; client check ≥12 and match (server is authoritative); on submit call `resetPassword(token, pw)`. Success → `router.push("/login?reset=1")`. Error (invalid/expired) → show the message with a link back to `/forgot`. If `token` is absent, show "This link is incomplete" pointing to `/forgot`.

- [ ] **4.4 — login link + notice.** In `apps/web/app/login/page.tsx`: add a "Forgot password?" link to `/forgot` near the password field; if `?reset=1` is present, show a success banner *"Password updated — sign in with your new password."*

- [ ] **4.5 — verify.** `cd apps/web && npx tsc --noEmit && npx next build` → clean. Then with the API running, drive in the browser: `/login` shows the link → `/forgot` submit shows the neutral notice → construct a valid `/reset?token=…` (from a token row) → set password → lands on `/login?reset=1` with the banner → sign in with the new password.

- [ ] **4.6 — commit** `feat(web): forgot-password and reset pages`. **STOP for review.**

---

## Deploy (later, not part of this build)
Add `RESEND_API_KEY` + `RESEND_FROM_EMAIL` to the `docket/prod/app` secret; migration `0009` runs via SSM on the EB instance (RDS is private); standard artifact build + EB deploy. Until the secret has the keys, forgot-password no-ops in prod (logs a warning) — deploy the secret with the code.

## Follow-ups (out of scope, flagged)
- **Session invalidation on reset** (stated non-goal — stateless JWTs).
- **No test framework** in Docket — verification here is tsc/build/curl/browser. Standing up jest for the API + a token-logic unit test is worth doing as its own change.

## Self-review
- **Spec coverage:** flow (T3/T4) · token table (T1) · sha256 single-use 1h supersede (T1 helper + T3) · 2 throttled pre-auth endpoints (T3) · enumeration parity (T3.8 #2) · Resend no-op module (T2) · secrets allow-list (T2.4) · env origin (T2.3) · frontend pages+link (T4) · deferred session-invalidation (Follow-ups). All covered.
- **Placeholders:** none — code shown for every code step; frontend pages specified by concrete elements + behaviour, reusing existing login-page styling.
- **Type consistency:** `generateResetToken()→{raw,hash}`, `hashResetToken(raw)→string`, `passwordResetTokens` columns (`tokenHash`,`usedAt`,`expiresAt`,`userId`) used identically across T1/T3; `EmailService.sendPasswordResetEmail(to,url)` defined T2 / called T3; `requestPasswordReset`/`resetPassword` defined T4.1 / used T4.2–4.4.
