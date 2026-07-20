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
