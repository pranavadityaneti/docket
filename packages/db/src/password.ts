import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing for Docket auth — argon2id (@node-rs/argon2 defaults are
 * OWASP-sane). The hash string is self-describing, so verify() reads its own
 * parameters; no shared config is needed between hashing and verifying.
 */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    // Malformed/unknown hash → treat as no-match rather than throwing.
    return false;
  }
}
