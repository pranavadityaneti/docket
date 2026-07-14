import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { users } from "./schema";
import { hashPassword } from "./password";

/**
 * Idempotently (re)set a password for an existing user — dev/admin bootstrap and
 * resets. Non-destructive: updates only password_hash on one row.
 *   ADMIN_EMAIL, ADMIN_PASSWORD override the defaults.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const email = process.env.ADMIN_EMAIL ?? "admin@finlot.ai";
  const password = process.env.ADMIN_PASSWORD ?? "DocketAdmin!2026";

  const db = createDb(url);
  const [updated] = await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.email, email))
    .returning({ id: users.id, email: users.email });

  if (!updated) throw new Error(`No user with email ${email}`);
  console.log(`Set password for ${updated.email}  (password: ${password})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
