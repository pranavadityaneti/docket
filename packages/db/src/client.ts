import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { RDS_CA_BUNDLE } from "./rds-ca";
import * as schema from "./schema";

/**
 * Decide the TLS posture for a connection string.
 *
 * RDS sets rds.force_ssl=1, so the connection is encrypted either way - but
 * `sslmode=require` encrypts WITHOUT checking who is on the other end, which
 * means anything able to intercept traffic inside the VPC can present its own
 * certificate and read every borrower document that passes. Verifying against
 * the Amazon RDS CA closes that.
 *
 * A local Postgres has no TLS at all, so verification is applied only when the
 * host is actually RDS. Forcing it everywhere would simply stop development
 * working, and a rule developers have to disable is a rule that gets disabled
 * in production too.
 */
export function sslFor(connectionString: string): postgres.Options<{}>["ssl"] {
  let host = "";
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return undefined;
  }
  const isRds = host.endsWith(".rds.amazonaws.com");
  if (!isRds) return undefined;

  // `ca` + rejectUnauthorized is verify-ca; `checkServerIdentity` left at the
  // Node default additionally matches the hostname, which is what makes this
  // verify-full rather than merely verify-ca.
  return { ca: RDS_CA_BUNDLE, rejectUnauthorized: true };
}

/** Create a Drizzle client bound to a Postgres connection string. */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 10, ssl: sslFor(connectionString) });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run `fn` inside a transaction scoped to a tenant. Sets the
 * `app.current_tenant` session GUC that the RLS policies read, so every
 * query inside is automatically isolated to that tenant.
 *
 * The API must connect as a NON-owner Postgres role for RLS to apply
 * (owners/superusers bypass RLS). Migrations & the seed run as the owner.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Switch to the non-owner app role so RLS applies even on a superuser
    // connection (local dev), then scope the tenant for this transaction.
    await tx.execute(sql`set local role docket_app`);
    await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`);
    return fn(tx);
  });
}
