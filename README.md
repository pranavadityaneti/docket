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
