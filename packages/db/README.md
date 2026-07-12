# @docket/db

Docket's data layer — Drizzle schema, migrations, seed, and the multi-tenant RLS model.

## Multi-tenancy (Row-Level Security)

Every tenant-scoped table carries `tenant_id`, and Postgres RLS enforces isolation **at the
database**, not just in app code. The operational model:

- **The API connects as a NON-owner Postgres role** — RLS applies to it. (Owners/superusers
  bypass RLS, so never point the API at the DB master user in production.)
- **Per request**, the API opens a transaction and sets the tenant:
  `select set_config('app.current_tenant', '<tenant-uuid>', true)` — see `withTenant()` in
  `src/client.ts`. Every query inside is then scoped to that tenant automatically.
- **Migrations & the seed run as the table owner** (bypass RLS), so seeding across tenants works.

## Commands

```bash
# DATABASE_URL must point at a Postgres (local Docker or RDS)
pnpm --filter @docket/db generate   # generate migration SQL from the schema
pnpm --filter @docket/db migrate    # apply migrations
pnpm --filter @docket/db seed       # seed the demo tenant + Business Loan workflow
pnpm --filter @docket/db studio     # Drizzle Studio (browse the DB)
```

## Files

- `src/schema.ts` — tables: tenants · users · memberships · workflows · workflow_stages ·
  lead_configs · contacts · leads. Configurable fields in JSONB.
- `src/client.ts` — `createDb(url)` + `withTenant(db, tenantId, fn)`.
- `src/seed.ts` — demo tenant/user + Business Loan workflow (12 stages, 8-field config).
- `migrations/` — generated table DDL + a hand-written RLS policies migration.
