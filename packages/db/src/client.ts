import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

/** Create a Drizzle client bound to a Postgres connection string. */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 10 });
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
