# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

OmniDesk is a multi-tenant SaaS for supervising customer conversations (WhatsApp) handled by AI (via n8n) and human agents, with an installable PWA. Docs, specs, code comments and UI copy are in **Spanish**; keep new ones in Spanish.

See also `AGENTS.md` (managed by turbo): read the installed `turbo` package's bundled `docs/` before changing Turborepo config or commands.

## Commands

Monorepo: pnpm workspaces (`apps/*`, `packages/*`, `tools/*`) + Turborepo. Node 24. Run from the repo root.

```bash
# Full local stack (postgres, api, web, caddy, minio). Always use the gateway URL:
cp .env.example .env && docker compose up --build   # http://localhost:8080/omnidesk

pnpm lint | pnpm typecheck | pnpm test | pnpm build | pnpm format
pnpm simulate            # seed 5 demo conversations through the real integration endpoints
pnpm simulate --live     # one new message every 4 s

# Single package / single test file
pnpm --filter @omnidesk/api exec vitest run src/modules/conversations/application/use-cases.spec.ts
pnpm --filter @omnidesk/web exec vitest run src/app/nav-item-label.spec.ts
pnpm --filter @omnidesk/api exec vitest run -t "name of the test"

# API e2e (needs the stack up; uses DB `<db>_e2e`, files run serially)
docker compose exec api pnpm --filter @omnidesk/api test:e2e
docker compose exec api pnpm --filter @omnidesk/api exec vitest run --config vitest.e2e.config.ts test/health.e2e-spec.ts

# Prisma
docker compose exec api pnpm --filter @omnidesk/api db:migrate   # create + apply a new migration
pnpm --filter @omnidesk/api db:generate                          # regenerate client into src/generated/prisma
```

Turbo tasks depend on `^build`, so `@omnidesk/contracts` must be built (`dist/`) before the API/web typecheck or test. When calling vitest/tsc directly via `--filter` instead of through turbo, build contracts first (`pnpm --filter @omnidesk/contracts build`) and run `db:generate` for the API.

The `api` container runs `db:deploy` + `db:app-role` on start. Source dirs are bind-mounted (hot reload); rebuild the image (`docker compose build`) after changing dependencies.

**New environment variables** must be added to `globalPassThroughEnv` in `turbo.json` (strict env mode filters everything else), validated in `apps/api/src/shared/config/env.ts`, and documented in `.env.example` (and `infra/deploy/.env.*.example` for the VPS).

pnpm refuses packages published less than 24 h ago; pin the previous version.

## Architecture

- `apps/api` — NestJS modular monolith, **hexagonal per module** (`src/modules/<module>/{domain,application,infrastructure}`). `modules/health` is the reference template. Cross-cutting code in `src/shared/` (`kernel`, `application` ports, `infrastructure/prisma`, `config`, `logging`).
- `apps/web` — Vite + React 19 SPA/PWA (React Router, TanStack Query, Tailwind 4, shadcn/ui, Workbox via `src/sw.ts`). Layout: `src/app` (router, providers, nav), `src/pages`, `src/features/<feature>/{api,model,ui}`, `src/shared`. `@` aliases `src/`.
- `packages/contracts` — zod schemas shared by API, web and simulator; the API generates OpenAPI (Swagger at `/api/docs`) from them. Contracts first: change the schema here, then both sides.
- `packages/eslint-config` — `nest.js` enforces layer boundaries; `pnpm lint` fails on violations.
- `tools/simulator` — hits the same integration endpoints n8n uses.
- `infra/` — `caddy` (local same-origin gateway), `gateway` (prod Caddy image with web build), `deploy` (VPS scripts, `deploy.sh <dev|prod> <git-ref>`).

### Layer rules (ESLint-enforced)

| Layer | May import | May not import |
| --- | --- | --- |
| `domain/` | its own domain, `shared/kernel` (relative imports only) | any package, `application/`, `infrastructure/` |
| `application/` | `domain/`, `@nestjs/common` (DI decorators only); defines ports + injection tokens | `infrastructure/`, `@prisma/*`, other `@nestjs/*` |
| `infrastructure/` | everything above, contracts, Prisma, libs | another module's infrastructure |

Modules talk through exported application services or domain events, never each other's infrastructure. In-memory fakes for unit tests live in `modules/<module>/testing/`.

### Key cross-cutting mechanics

- **Same origin under `/omnidesk`.** Web and API share one origin in every environment. Caddy strips `/omnidesk` before proxying `/omnidesk/api/*` to the API, which serves `/api/*`. The web knows `BASE_PATH` at build time; the API uses `PUBLIC_BASE_PATH` only for the cookie path and public URLs. Vite on :5173 has no API proxy, so use :8080.
- **Tenant isolation (SPEC 12).** The tenant always comes from the session or integration credential, never the request body. PostgreSQL RLS is enabled on the business tables: tenant requests run under the `omnidesk_app_login` role (`DATABASE_APP_URL`, no `BYPASSRLS`) with `app.tenant_id` set per transaction (`shared/infrastructure/prisma/tenant-prisma.ts`, `tenant-scope.ts` via AsyncLocalStorage). Code outside a tenant scope uses the owner role (system paths); with RLS, a missing scope returns no rows (fails closed). New tenant tables need `tenant_id` plus an RLS policy in the migration.
- **Reliability patterns.** Transactional Outbox (state change + event in one tx, dispatched later to Socket.IO / providers with retries; `modules/realtime/infrastructure/outbox-dispatcher.ts`), Inbox dedup by `(source, externalId)`, and `Idempotency-Key` on client/integration commands. Conversation commands are `POST /:id/<command>`, not `PATCH`.
- **AI control protocol.** Assigning a conversation to an agent turns AI off for it. `controlVersion` guards against late AI replies, and the AI reply is recorded before it is sent. Messages are ordered by per-conversation `sequence`.
- **Providers via ports.** Outbound goes through the `MessagingProvider` port; inbound through per-provider normalizers. Channel providers: `WHATSAPP_CLOUD` (direct Meta webhook, optional n8n AI), legacy `N8N`, and `SIMULATED` (demo).
- **Auth.** Google OAuth via Passport, plus an opaque `omnidesk_session` httpOnly cookie (sha256 stored in `sessions`, 30-day sliding). Socket.IO handshake uses the same cookie. Roles: `OWNER` / `ADMIN` / `AGENT`; platform admins come from `PLATFORM_ADMIN_EMAILS`.
- **Demo mode.** `DEMO_MODE=true` (forbidden with `NODE_ENV=production`) seeds a demo tenant and channel and enables `POST /api/v1/auth/dev-login` ("Entrar como …" buttons on `/login`).
- **Service worker** precaches only the app shell and never caches API responses. New versions prompt the user instead of auto-reloading.

## Workflow

- Every increment starts as a spec in `specs/NN-name.md`. Architecture and roadmap: `docs/arquitectura.md`; data and retention: `docs/datos.md`; deployment: `docs/despliegue.md`; n8n: `docs/integracion-n8n.md`; observability: `docs/observabilidad.md`. Project skills `/spec` and `/spec-impl` (in `.claude/skills/`) create specs and implement approved ones.
- Commit style: Conventional Commits with app scope and spec reference, e.g. `feat(api,web): … (SPEC 21)`, `docs: add SPEC 20 for …`.
- Formatting: Prettier (`.prettierrc`), EditorConfig.
