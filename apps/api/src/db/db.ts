import { Global, Injectable, Module } from "@nestjs/common";
import { createDb, withTenant, type Db, type Tx } from "@docket/db";

@Injectable()
export class DbService {
  private readonly _db: Db;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    this._db = createDb(url);
  }

  /** Connection-role access (bypasses tenant RLS) — auth / user & membership lookups only. */
  get admin(): Db {
    return this._db;
  }

  /** Tenant-scoped access — RLS enforced (SET ROLE docket_app + app.current_tenant). */
  withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this._db, tenantId, fn);
  }
}

@Global()
@Module({ providers: [DbService], exports: [DbService] })
export class DbModule {}
