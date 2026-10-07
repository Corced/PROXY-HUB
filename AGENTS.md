# AGENTS.md — PROXY-HUB

Self-hosted AI gateway (New API fork) + DiscordGate (Discord-gated access layer).
No root package manager workspace: `new-api/` is Go+Bun, `packages/*` are independent npm projects.

## Repo map

- `new-api/` — Go gateway (fork of QuantumNous/new-api) + React 19 web UI (`new-api/web/`, Bun + Rsbuild).
  **Read `new-api/AGENTS.md` and `new-api/web/AGENTS.md` before touching those trees** — mandatory Go/i18n/billing/cross-DB rules, and the "new-api"/"QuantumNous" branding is protected (never remove/rename).
- `new-api/relaykit/` — separate Go module. Build/test only with `GOWORK=off`.
- `packages/discord-gate/` — TS/Express sidecar (port 3001): Discord OAuth, `/auth/verify` for Caddy forward_auth, New API revocation bridge, 15 RPM rate limiter, guild sync scheduler, `discord_gate_*` DB tables.
- `packages/bot/` — TS discord.js bot (port 3002): member leave/ban → sidecar revoke, slash commands (`/checkaccess`, `/revokeaccess`, `/apikeys`, `/syncmembers`…).
- `bridge/` — compose builds `../bridge` but it is **not in the repo**; full `docker compose up` fails until it exists.
- `.env.example` (root) documents every env var; copy to `new-api/.env` before compose.

## Commands

- Web: `cd new-api/web && bun install && bun run dev` — build: `bun run build`
- Backend: `cd new-api && go run main.go` — tests: `make test` (root module + relaykit, `GOWORK=off`)
- Sidecar: `cd packages/discord-gate && npm install --legacy-peer-deps` (plain `npm install` fails: vitest@5 peers `@types/node` ^22 vs pinned ^20) → `npx tsc --noEmit` → tests `npx vitest run`
- Bot: `cd packages/bot && npm install && npx tsc --noEmit` — **requires `packages/discord-gate/dist` to exist** (build sidecar first: `npx tsc`). Bot imports sidecar source via tsconfig path alias.
- Stack: `cd new-api && cp ../.env.example .env && sh scripts/generate-secrets.sh >> .env` → fill values → `docker compose up -d`. Dev: add `-f docker-compose.override.yml` (localhost ports, hot reload). Prod: `-f docker-compose.prod.yml`.

## Gotchas

- **Docker build contexts are broken as committed**: `new-api/docker-compose.yml` sets `build.context: .` (new-api/) for bot/discord-gate, but their Dockerfiles `COPY packages/...` which only exists at repo root. `docker compose build bot` fails. Same for `bridge` (`../bridge` missing). Verify contexts before relying on compose.
- **Config validation is lazy**: `discordGateConfig` validates on first property access, not import. Tests must set env in `tests/globalSetup.ts` (runs before config loads); under vitest `validateEnv` throws instead of `process.exit`. `NODE_ENV` schema includes `test`.
- **Sidecar tests need live infra**: vitest connects to real Redis + PostgreSQL (`POSTGRES_HOST` etc. default `postgres`/`localhost`). Without them suites fail (ECONNREFUSED/ENOTFOUND) — start the stack or run only the script/config checks in `security.fixes.test.ts`.
- **`tsc` ignores `tests/`**: discord-gate `tsconfig.json` includes only `src/**`; tests are transformed by vitest. Don't try to fix test type errors with `tsc`.
- **New API refuses weak defaults**: container entrypoint runs `scripts/check-defaults.sh` (empty/default `INITIAL_ADMIN_PASSWORD`, or secrets <32 chars → exit 1). `generate-secrets.sh` appends to `.env`.
- **Networks**: `proxy` (public) vs `internal` (`internal: true`). Caddy = proxy only; postgres/redis/bot = internal only; new-api/discord-gate/bridge = both. New services join the wrong one = unreachable.
- **Caddyfile**: `forward_auth discord-gate:3001` → `/auth/verify` gates everything except `/auth/discord*`, `/auth/denied*`, `/health`. Admin paths restricted to `CADDY_ADMIN_ALLOWLIST`. JSON access log at `/var/log/caddy/access.log` carries `X-Discord-User-ID`; query with `scripts/audit-log-query.sh`.
- **Env contract is strict**: Discord creds (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID/SECRET`, `DISCORD_REDIRECT_URI`, `TARGET_GUILD_ID`, `DISCORD_INVITE_LINK`, `SITE_URL`), `POSTGRES_*`, `DISCORD_API_BASE`, `DISCORD_GATE_INTERNAL_URL` are zod-validated — a missing var is a hard startup failure, not a warning.
- **Secrets hygiene**: `.env` and `docker-compose.override.yml` are gitignored. Never commit `.env`; `generate-secrets.sh` uses openssl.
