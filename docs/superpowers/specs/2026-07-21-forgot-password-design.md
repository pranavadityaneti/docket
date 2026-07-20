# Forgot-password flow — design spec

**Date:** 2026-07-21
**Status:** approved (design); implementation not started
**Scope:** `apps/api` (auth + new email module + config), `packages/db` (one table + migration), `apps/web` (login link + two pages + two client fns)

## 1 · Goal

Let a user who cannot log in set a new password themselves, by receiving a one-time
link over email — replacing the manual, operator-run hash-reset done on 2026-07-21.

### Non-goals (explicitly out of scope)

- **Session invalidation on reset.** Docket's JWTs are stateless (7-day expiry, no session
  store), so an existing logged-in session survives a reset until it expires. Killing other
  sessions needs a `passwordChangedAt` claim/check wired into the JWT guard — a separate
  change. Deferred by decision; residual risk is low (≈1 user, 7-day tokens). Tracked as a
  follow-up.
- Account lockout / brute-force beyond the existing `@Throttle`.
- Email-change / account-recovery beyond password.
- Any UI for the operator manual-reset path (unchanged; remains available).

## 2 · Flow

1. On `/login`, a **"Forgot password?"** link → `/forgot`.
2. `/forgot`: user enters email → `POST /auth/forgot-password` → page always shows
   *"If that email is registered, we've sent a reset link."*
3. If the email maps to a user, the API creates a reset token and emails a link to
   `${WEB_ORIGIN}/reset?token=<raw-token>` (1-hour expiry).
4. `/reset`: reads `?token=`, user enters new password + confirm →
   `POST /auth/reset-password` → on success redirect to `/login` with a success notice.
5. Token is consumed (single-use); user logs in with the new password.

## 3 · Data model

New **global** table (per-user, not tenant-scoped — same class as `users`/`memberships`,
reached via the owner DB role pre-auth, exactly as `login` already does through `db.admin`).

```
password_reset_tokens
  id           uuid   pk default gen_random_uuid()
  user_id      uuid   not null → users(id) on delete cascade
  token_hash   text   not null            -- sha256(raw token), hex; never the raw token
  expires_at   timestamptz not null
  used_at      timestamptz                -- null until consumed
  created_at   timestamptz not null default now()

  index on (token_hash)   -- lookup path
  index on (user_id)      -- invalidate-prior + cleanup
```

- **No `tenant_id`, no RLS.** A reset is about a person, who may belong to several tenants.
  Consistent with `users` (global, owner-accessed). The migration grants the same privileges
  the owner role already holds on `users`.
- Migration: `0009_password_reset_tokens.sql` (hand-authored footer style consistent with
  0006/0008; journal entry appended with a `when` > 0008).

## 4 · Token lifecycle

- **Generation:** `crypto.randomBytes(32)` → base64url. This raw value goes **only** into the
  email link.
- **At rest:** store `sha256(raw)` hex in `token_hash`. A DB compromise yields no usable
  token (sha256 is sufficient — the token is 256 bits of entropy, so slow hashing buys
  nothing; this is the standard reset-token pattern, distinct from password hashing which
  uses argon2 because passwords are low-entropy).
- **Single-use:** set `used_at` on successful reset.
- **Expiry:** 1 hour from creation.
- **Supersede:** requesting a new token marks all of that user's prior unused, unexpired
  tokens as used (`used_at = now()`), so only the latest link works.

## 5 · Endpoints

Both live in the existing `AuthController` (auth module), both **pre-auth** (no `JwtAuthGuard`),
both `@Throttle`d.

### `POST /auth/forgot-password`
- Body: `{ email: string }` (DTO: `@IsEmail`).
- **Always** returns `200 { ok: true }` — identical response and near-identical latency whether
  or not the email exists (no account enumeration; mirrors the dummy-hash pattern `login`
  already uses).
- If the email resolves to a user: supersede prior tokens, insert a new token, send the email.
  Email-send failures are logged, not surfaced to the caller (still 200) — a failed send must
  not reveal that the account exists, and is a transient we retry via re-request.
- Throttle: `{ limit: 3, ttl: 60_000, blockDuration: 300_000 }` (stricter than login's 5).

### `POST /auth/reset-password`
- Body: `{ token: string, password: string }` (DTO: `@IsString @MinLength(1)` token;
  `@IsString @MinLength(12) @MaxLength(200)` password — matches the manual script's ≥12 rule).
- Look up by `sha256(token)`; reject (`400`, generic message) if not found, expired, or used.
- On success: `hashPassword(password)` → update `users.password_hash`; set `used_at` on the
  token. Return `200 { ok: true }`.
- Throttle: `{ limit: 5, ttl: 60_000, blockDuration: 300_000 }`.

## 6 · Email module (new, `apps/api/src/email/`)

- Thin wrapper over the Resend SDK, mirroring Finlot's `lib/lead-confirmation-email.ts`:
  reads `RESEND_API_KEY` + `RESEND_FROM_EMAIL`; if either is unset, **logs a warning and
  no-ops** (so local dev and tests run with no email credentials, same philosophy as
  `hydrateSecrets`).
- One function for this flow: `sendPasswordResetEmail(to, link)`. Plain, minimally branded
  body: what it is, the link, "expires in 1 hour", "ignore if you didn't request this".
- Reuses the existing Resend account + verified `finlot.ai` domain; sender `no-reply@finlot.ai`
  (or `RESEND_FROM_EMAIL`).

## 7 · Config / secrets

- `apps/api/src/config/env.ts`: surface `resendApiKey`, `resendFromEmail` (optional; when
  absent the email module no-ops). The reset link's origin is **the first entry of
  `WEB_ORIGIN`** — treated as the canonical app origin (it is already required in prod and is
  the dashboard's own origin). No new env var; no origin ever comes from request input.
- `apps/api/src/config/secrets.ts`: extend the `ALLOWED` set to accept `RESEND_API_KEY` and
  `RESEND_FROM_EMAIL` from Secrets Manager.
- Deploy adds `RESEND_API_KEY` + `RESEND_FROM_EMAIL` to the `docket/prod/app` secret.

## 8 · Frontend (`apps/web`)

- `lib/api.ts`: `requestPasswordReset(email)` and `resetPassword(token, password)` — pre-auth
  `fetch` (no Bearer), like `login`.
- `/login`: add a "Forgot password?" link.
- `/forgot`: email field; on submit always shows the neutral "if registered…" message.
- `/reset`: reads `?token=` from the URL; password + confirm fields; client-side ≥12 +
  match check (server is authoritative); success → redirect to `/login` with a notice; invalid/
  expired token → clear message pointing back to `/forgot`.

## 9 · Security properties (the checklist this must satisfy)

- No account enumeration (forgot-password always 200; reset errors are generic).
- Raw token only in the email; only its sha256 is stored.
- Single-use, 1-hour expiry, prior tokens superseded on re-request.
- Password ≥12 enforced server-side; hashed with argon2 via existing `hashPassword`.
- Rate-limited on both endpoints.
- Reset link built from a server-side allow-listed origin, never from request input.
- **Known residual:** existing JWT sessions survive a reset (see Non-goals).

## 10 · Deploy notes (for later, not part of build)

- Migration `0009` runs via SSM on the EB instance (RDS is private) — same path as 0007/0008.
- `RESEND_*` added to `docket/prod/app` before/with the deploy, else forgot-password no-ops in
  prod (logs a warning).
- Standard artifact build + EB deploy per `.artifact/api/README.md`.

## 11 · Testing / verification

- Unit-level: token hashing round-trip; expiry and single-use rejection; enumeration response
  parity (exists vs not → same body/status).
- Manual end-to-end in dev (Resend keys or the no-op path): request → link → reset → login with
  new password; expired token rejected; reused token rejected; second request invalidates first.
