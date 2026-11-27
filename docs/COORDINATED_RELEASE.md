# Coordinated Workers AI & v1.5 Release Gate

## Problem

Merging changes to `main` triggers GitHub Pages deploy (`.github/workflows/deploy.yml`).
Each release of AegisMap depends on strict contract parity between the Cloudflare Worker backend and the Vite + React frontend:
- Publishing an updated frontend against an older Worker would break `/api/v2/disasters`, `/api/v1/warnings`, `/api/v1/sar-scenes`, `/api/v1/history`, `/api/v1/analytics/sources`, or `/api/v1/subscriptions`.
- All Worker routes preserve strict backward compatibility for `/api/disasters`, `/api/tles`, `/api/fire-hotspots`, `/api/analyze`, and `/api/v2/disasters`.

## Enforceable Gate (in Workflow)

Before building or publishing Pages on `main`, CI polls `GET /` on `VITE_API_BASE_URL` and verifies:
- `body.commitSha === GITHUB_SHA` (immutable deployed Worker identity — prevents skipped deploys or stale Workers advertising identical capability strings from passing).
- `body.services?.d1 === "ready"` (confirming all 6 required D1 tables exist on the bound production database `aegis-map-db`).
- `capabilities` includes all 7 items of `API_CAPABILITIES` (`shared/contracts.ts`).

CI also executes non-mutating smoke checks on `GET /api/v2/disasters?window=24h`, `GET /api/v2/disasters?window=7d`, `GET /api/v1/warnings?lat=59.9139&lng=10.7522&country=NO`, `GET /api/v1/history?limit=5`, `GET /api/v1/analytics/sources`, and `GET /api/v1/subscriptions/status`.

`ALLOW_SANDBOX_EMAIL` is intentionally enabled only in `vitest.wrangler.jsonc` and `env.preview`. Production omits both `ALLOW_SANDBOX_EMAIL` and `RESEND_API_KEY` unless email sending is explicitly configured, causing `/api/v1/subscriptions/status` and `/api/v1/subscriptions` to report `available: false` / `503 delivery_unavailable` honestly without issuing fake preview tokens.

1. `workers-ai-analyze-v1`: analyze successes carry `source: "workers-ai"`.
2. `provider-status-v1`: FIRMS coverage windows and `firms_unavailable` 502, `X-Disaster-*` source headers, `X-TLE-*` headers.
3. `firms-global-v2`: Worldwide FIRMS VIIRS ingestion, split-KV atomic pairing (checksum + length + LKG), and `/api/v2/disasters`.
4. `official-warnings-v1`: `GET /api/v1/warnings` CAP v1.2 + pilot authority adapters.
5. `sar-stac-v1`: `GET /api/v1/sar-scenes` Copernicus Data Space Sentinel-1 GRD search.
6. `disaster-history-v1`: `GET /api/v1/history` & `GET /api/v1/analytics/sources` backed by D1 (`AEGIS_DB`).
7. `warning-subscriptions-v1`: `POST /api/v1/subscriptions*` opt-in email confirmation & durable outbox (`sms_deferred` 501).

CI also executes smoke checks on `GET /api/v2/disasters?window=24h`, `GET /api/v2/disasters?window=7d`, and `GET /api/v1/warnings?lat=59.9139&lng=10.7522&country=NO`.

## Deployment Pipeline & Secrets

The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs checks on `pull_request` and executes coordinated backend-first deployment on `push` to `main`:

1. **`deploy-backend` job**:
   - Runs `cd backend && npm run typecheck && npm test`.
   - On `push` to `main`, deploys the Worker via `npx wrangler deploy --var GIT_SHA:${GITHUB_SHA}`.
   - Required secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
   - **Important**: Before deploying production v1.5 Worker code, apply D1 migrations cleanly via `npx wrangler d1 migrations apply AEGIS_DB --remote` and run bounded backfill (`node scripts/backfill-history.mjs --days 14 --limit 100 --remote`).
2. **`build-frontend` job** (`needs: [deploy-backend]`):
   - Runs `cd frontend && npm run lint && npm test`.
   - On `push` to `main`, verifies live Worker `/` capabilities and runs `/api/v2/disasters` + `/api/v1/warnings` smoke checks.
   - Builds `frontend/dist` (`VITE_MAPBOX_TOKEN`, `VITE_API_BASE_URL`).
3. **`deploy-frontend` job** (`needs: [build-frontend]`):
   - Publishes `frontend/dist` to GitHub Pages.

## Isolated Preview Staging & Rollback Procedure

Never test migrations, backfill, or sandbox subscriptions directly against production `AEGIS_CACHE` (`7f6c89c7faa84c288f31941bef51b14c`). Use `--env preview` in `backend/wrangler.jsonc`:

```bash
cd backend
npx wrangler d1 migrations apply AEGIS_DB --remote --env preview
node scripts/backfill-history.mjs --days 7 --limit 40 --remote --env preview
npx wrangler deploy --env preview --var GIT_SHA:$(git rev-parse HEAD)
```

To roll back a problematic Worker deployment without touching Pages or re-building:

```bash
cd backend
npx wrangler deployments list --env preview
npx wrangler rollback --env preview -y
```

And if a D1 schema regression occurred in a migration, do **not** drop production tables mid-flight; revert Worker traffic with `wrangler rollback` first (all additive v1.5 tables are backward-compatible with v1.4/v1.5 read queries), verify `GET /` `commitSha`, and fix forward with a new numbered migration.

## Why Worldwide FIRMS Ingestion Runs Off-Worker

Worldwide VIIRS thermal hotspot CSVs across 3 sensors (`VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT`) span ~17 MB / 200k+ rows for `24h` and exceed Cloudflare Workers Free 10 ms CPU / 128 MB memory / 30 s `waitUntil` bounds. `.github/workflows/firms-ingest.yml` (`17 */3 * * *`) executes `backend/scripts/ingest-firms.mjs` on Node 22 and writes split `cells` (first) then `meta` (second) keys with `cellsChecksum` (FNV-1a 64-bit) + `cellsCharLength` + `snapshotId` into KV so Workers serve `GET /api/v2/disasters` with zero multi-MB `JSON.parse`.
