# Docket — Finlot AI Workforce Platform

The in-house, Gain-class platform for loan origination: CRM, cloud contact centre,
WhatsApp & email AI agents, document validation engine, and workflow builder.
Dashboard is served at **docket.finlot.ai** (the marketing site stays on finlot.ai).

> Master plan: see `Finlot/docs/finlot-ai-workforce-platform-project-plan.html` in the
> sibling marketing repo. This repo is Phase 0 → scaffolding onward.

## Monorepo layout

```
apps/
  web/          Next.js 16 dashboard (React 19, Tailwind v4, shadcn/ui)
packages/       (coming next) db · ui · shared · api · workers
```

## Getting started

```bash
pnpm install
pnpm dev        # runs the dashboard at http://localhost:3000
```

## Design system

- Light-theme dashboard; neutral surfaces with **teal (`#30D5C8`) as a restrained accent**.
- shadcn/ui components; brand teal mapped to `--primary` / `--ring`; deeper teal
  (`#0d9488`) for solid buttons (contrast), bright teal for accents/active states/charts.
- Status colours keep conventional meaning: success = green, warning = amber, error = red.

## Deploys — commit identity matters

The web app deploys to Vercel (project `docket`, account `ideaye`). On the Hobby
plan a **private** repo only deploys commits whose author is the account owner —
a commit from any other identity is refused with "Deployment Blocked: the commit
author did not have contributing access", **before the build starts**, so there
are no build logs to read.

Vercel runs **two** checks, and they are different things:

1. the commit email must resolve to a **GitHub account** (not a Vercel account
   email — `ideayemedia@gmail.com` is the Vercel login and matches no GitHub
   user, which fails here); and
2. that GitHub account must have contributing access to the Vercel project.

Use the ID-prefixed GitHub noreply, which is GitHub's canonical form and always
resolves:

```bash
git config --local user.email "63978595+pranavadityaneti@users.noreply.github.com"
git config --local user.name  "Pranav Aditya N"
```

Vercel's "Fix Git Configuration" button on a blocked deployment is authoritative
if this ever changes.

Note: an **empty commit does not trigger a deployment** — Vercel skips commits
with no file changes, so use a real change to force a rebuild.

This bit us for two days: a stale `user.email` override in this repo meant every
push was silently rejected while production kept serving an old build. If deploys
stop, check `git log -1 --format=%ae` before suspecting the build.

The deployed commit is shown in the app — sidebar footer and, deliberately, the
**login page** (pre-auth, so staleness is checkable without signing in).
