/** Server-issued User ID (`DPU-XXXXXXX`). Distinct from the UUID `users.id`. */

import { isPublicId, normalizePublicId, publicIdError } from "./public-id";

export const LOGIN_ID_MIN = 11;
export const LOGIN_ID_MAX = 16;

export function normalizeLoginId(raw: string): string {
  return normalizePublicId(raw);
}

export function isLoginId(value: string): boolean {
  return isPublicId("user", value);
}

export function loginIdError(raw: string): string | null {
  return publicIdError("user", raw);
}

export type IdentityRow = { id: string };

/**
 * Email must point at one person (or not exist yet). User IDs are server
 * issued, so create paths only collide on email.
 */
export function identityConflict(
  byLoginId: IdentityRow | undefined,
  byEmail: IdentityRow | undefined,
): "login_id" | "email" | "mismatch" | null {
  if (byLoginId && byEmail && byLoginId.id !== byEmail.id) return "mismatch";
  if (byLoginId && !byEmail) return "login_id";
  if (!byLoginId && byEmail) return "email";
  return null;
}

export function identityConflictMessage(
  kind: "login_id" | "email" | "mismatch",
): string {
  if (kind === "login_id") return "That user ID is already in use";
  if (kind === "email") return "That email is already in use";
  return "User ID and email belong to different accounts";
}
