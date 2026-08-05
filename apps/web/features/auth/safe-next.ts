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
