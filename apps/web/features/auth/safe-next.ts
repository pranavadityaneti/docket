/**
 * Where to send the user after sign-in, from ?next=.
 *
 * `next` is attacker-controllable - anyone can craft a link to our real login
 * page - so it must never be handed to the router unchecked. Only same-origin,
 * absolute-path targets are allowed.
 */
export const DEFAULT_POST_LOGIN = "/cases";

export function safeNext(raw: string | null, fallback = DEFAULT_POST_LOGIN): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

export const DEFAULT_POST_ADMIN_LOGIN = "/admin";

/** Post-login target for the platform console - must stay under /admin. */
export function safeAdminNext(raw: string | null): string {
  const next = safeNext(raw, DEFAULT_POST_ADMIN_LOGIN);
  if (next === "/admin" || next.startsWith("/admin/")) return next;
  return DEFAULT_POST_ADMIN_LOGIN;
}
