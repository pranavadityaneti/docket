# @docket/api

NestJS API for Docket. Multi-tenant: every request is authenticated, and tenant
data is scoped by Postgres Row-Level Security (see `packages/db`).

## Environment

Validated at boot by `src/config/env.ts` - the process **refuses to start** if
anything required is missing, rather than coming up misconfigured.

| Var            | Required            | Notes                                                                                   |
| -------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `DATABASE_URL` | always              | Postgres connection string                                                              |
| `JWT_SECRET`   | always              | No default. Boot fails without it.                                                      |
| `WEB_ORIGIN`   | **production only** | Comma-separated CORS allow-list. Unset in dev = reflect any origin (local convenience). |
| `API_PORT`     | no                  | Defaults to `3333`                                                                      |
| `NODE_ENV`     | no                  | `production` enables the `WEB_ORIGIN` requirement and `trust proxy`                     |

## Dev

```bash
pnpm --filter @docket/api dev      # watch mode
```

Runs TypeScript directly via `@swc-node/register` - SWC rather than esbuild
because esbuild silently strips `emitDecoratorMetadata`, which NestJS needs for
constructor injection (symptom: every injected dependency is `undefined`, with
no error at boot).

The `--conditions development` flag makes `@docket/db` resolve to its **source**
(`packages/db/src`), so changes there are picked up without a rebuild.

## Production build

```bash
pnpm --filter @docket/db  build    # @docket/db must be built first
pnpm --filter @docket/api build
node dist/main.js
```

Compiles to **CommonJS** in `dist/`:

- **Why compiled:** prod shouldn't depend on `@swc-node/register`, which uses
  Node's deprecated `module.register()` (DEP0205) - a future Node release
  removing it would break boot. The compiled build is plain `node`.
- **Why CommonJS:** our source uses extensionless relative imports. Node's ESM
  loader rejects those at runtime and SWC doesn't rewrite them; CJS resolves
  them fine.
- Both packages are `"type": "module"`, so `scripts/mark-cjs.mjs` writes a
  `dist/package.json` with `{"type":"commonjs"}` to scope the output back to CJS.

Without `--conditions development`, `@docket/db` resolves to its compiled
`dist/` - so the prod build carries no TypeScript runtime.

## Deployable artifact (Elastic Beanstalk)

```bash
pnpm --filter @docket/db  build
pnpm --filter @docket/api build
pnpm deploy --filter=@docket/api --prod --legacy ./.artifact/api
node scripts/prune-escaping-symlinks.mjs ./.artifact/api   # required - see below
zip -ry docket-api.zip . -x "*.DS_Store"                   # -y: store symlinks, don't follow
```

`pnpm deploy` is required: in a pnpm workspace `@docket/db` is a symlink, which
a plain zip of this directory would not carry. It produces a directory that runs
with no workspace present. `Procfile` tells EB to start it with
`node dist/main.js`.

**The prune step is not optional.** `pnpm deploy` leaves one link in the virtual
store pointing back at the workspace source
(`node_modules/.pnpm/node_modules/@docket/api -> ../../../../../../apps/api`).
It resolves on the build machine, so the artifact looks fine and runs fine
there - but EB recursively chowns the staged bundle, and off the build machine
that link dangles:

```
[ERROR] StageApplication ... chown /var/app/staging/node_modules/.pnpm/node_modules/@docket/api:
        no such file or directory
```

The deploy aborts and rolls back. Test for escapes by resolving link targets,
not by checking existence - on the build machine the target does exist.

Verified: the artifact boots, authenticates and serves `/leads` standalone -
and, after pruning, unzips and boots in a directory with no workspace above it.

> **Run `pnpm install` afterwards.** `pnpm deploy --prod` leaves the _workspace_
> flagged production-only. Every subsequent `pnpm run <script>` then fails - its
> dependency check tries `pnpm install --production`, which wants to purge dev
> dependencies and aborts without a TTY
> (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`). A plain `pnpm install` restores
> it. Reproduced: script exits 0 → deploy → same script exits 1 → install → 0.

### Known gap

Throttler storage is in-memory, so rate-limit buckets are per-instance. Fine on
a single EB instance; scaling out needs shared storage (Redis) or the effective
limit multiplies and a blocked client can hop instances.
