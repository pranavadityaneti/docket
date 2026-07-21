import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Reversible encryption for credentials we must store and later replay.
 *
 * Passwords use argon2 precisely because nobody ever needs the original back.
 * A tenant's mailbox password is the opposite: we have to present it to their
 * IMAP server on every poll, so it must be recoverable — which means encrypted,
 * not hashed. Different problem, different tool.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to open rather
 * than decrypting to garbage we would then send somewhere. The IV is random per
 * call, so encrypting the same password twice yields different output and the
 * database reveals nothing by comparison.
 *
 * The key lives in Secrets Manager alongside JWT_SECRET — the same posture, and
 * the same blast radius. KMS would be stronger (the key never leaves AWS, and
 * every use is logged in CloudTrail); this is the deliberate trade for not
 * adding a per-request AWS dependency to the mail poller. Worth revisiting once
 * tenants other than us have credentials in here.
 */

const VERSION = "v1";

/** Any-length key material -> a 32-byte AES key. */
function keyBytes(key: string): Buffer {
  if (!key || key.trim().length < 16) {
    throw new Error("Channel secret key is missing or too short (need >= 16 chars)");
  }
  return createHash("sha256").update(key).digest();
}

/** Encrypt a credential. Output is safe to store as text. */
export function sealSecret(plaintext: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

/** Decrypt a credential sealed by sealSecret. Throws if tampered or wrong key. */
export function openSecret(sealed: string, key: string): string {
  const [version, ivB64, tagB64, ctB64] = sealed.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Sealed secret is malformed");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
