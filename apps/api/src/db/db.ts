import { Global, Injectable, Module } from "@nestjs/common";
import { createDb, withTenant, type Db, type Tx } from "@docket/db";
import { env } from "../config/env";

@Injectable()
export class DbService {
  private readonly _db: Db;

  constructor() {
    this._db = createDb(env.databaseUrl);
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
