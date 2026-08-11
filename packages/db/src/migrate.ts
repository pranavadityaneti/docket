// Production migration runner.
//
// `pnpm migrate` uses the drizzle-kit CLI, which is a devDependency and is
// stripped by `pnpm deploy --prod` - so the deployed artifact can't use it.
// drizzle-orm ships its own migrator and is a production dependency, so this
// runs from the artifact with nothing extra installed.
//
// Applies only what's outstanding (drizzle records applied migrations in
// drizzle.__drizzle_migrations), so re-running is a no-op and it's safe on
// every deploy.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import postgres from "postgres";
import { sslFor } from "./client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set - refusing to migrate.");

  // Compiled to CommonJS (see .swcrc), so __dirname resolves to dist/ and the
  // migrations sit alongside it in the package. Overridable for odd layouts.
  const migrationsFolder =
    process.env.MIGRATIONS_DIR ?? path.join(__dirname, "..", "migrations");

  // max: 1 - migrations must run serially on a single connection.
  // Same TLS posture as the API - a migration runner that verifies less than
  // the application is a hole with a schedule.
  const sql = postgres(url, { max: 1, onnotice: () => { }, ssl: sslFor(url) });
  try {
    console.log(`Applying migrations from ${migrationsFolder} ...`);
    await migrate(drizzle(sql), { migrationsFolder });
    console.log("Migrations up to date.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
