# Coordinated Workers AI release gate

## Problem

Merging `frontend/**` to `main` triggers GitHub Pages deploy
(`.github/workflows/deploy.yml`). The new Sidebar requires
`source: "workers-ai"` on successful `/api/analyze` responses. The baseline
Worker on `main` does not provide that field.

Publishing the new frontend against an unverified legacy backend would leave
analysis permanently unavailable or misfail — never mislabel legacy text as
Workers AI.

## Enforceable gate (in workflow)

Before building Pages, CI calls the configured production API health endpoint
and requires its `capabilities` array to contain every capability the
frontend relies on (`API_CAPABILITIES` in `backend/src/config.ts`):

- `workers-ai-analyze-v1`: analyze successes carry `source: "workers-ai"`.
- `provider-status-v1`: FIRMS coverage windows and `firms_unavailable` 502,
  `X-Disaster-*` source headers, `X-TLE-*` headers.
- `firms-global-v2`: Worldwide FIRMS VIIRS ingestion, spatial grid aggregation,
  and `/api/v2/disasters` endpoint.

Additionally, CI executes automated smoke checks verifying that both
`GET /api/v2/disasters?window=24h` and `GET /api/v2/disasters?window=7d`
return HTTP 200 with `version: 2` on the live Worker before building and
publishing the frontend.

## Deployment pipeline and secrets

The GitHub Actions workflow (`.github/workflows/deploy.yml`) coordinates deployment
in a strict backend-first sequence using Node 22:

1. **`deploy-backend` job**:
   - Validates that `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set (fails fast with actionable setup instructions if missing).
   - Runs backend typecheck (`npm run typecheck`) and Vitest test suite (`npm test`).
   - Executes `npx wrangler deploy` to Cloudflare.
   - Requires repository secrets:
     - `CLOUDFLARE_API_TOKEN`: Cloudflare API token with `Workers Scripts: Edit` and `Workers KV Storage: Edit` permissions.
     - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account identifier.
   - **Important**: `FIRMS_MAP_KEY` is configured both as a GitHub Actions secret (for the scheduled off-Worker ingestion workflow `.github/workflows/firms-ingest.yml`) and as a Cloudflare Worker secret (for local bbox `/api/fire-hotspots`). The deploy job preserves existing Worker secrets and never overwrites them. Never commit tokens, and do not set `VITE_FIRMS_API_KEY` (any `VITE_*` variable is embedded into the public client bundle).

2. **`build-frontend` job** (`needs: [deploy-backend]`):
   - Verifies the backend contract (`firms-global-v2` capability).
   - Runs smoke checks on `GET /api/v2/disasters?window=24h` and `GET /api/v2/disasters?window=7d`, asserting HTTP 200 and `version: 2`.
   - If the live Worker reports `sources.firms.status === "unavailable"` (no snapshot seeded yet), automatically dispatches `.github/workflows/firms-ingest.yml`.
   - Builds frontend with Vite (`npm run build`).
   - Requires repository secrets:
     - `VITE_API_BASE_URL`: Live Worker URL (e.g. `https://aegis-map-backend.smah0085.workers.dev`).
     - `VITE_MAPBOX_TOKEN`: Mapbox public access token.

3. **`deploy-frontend` job** (`needs: [build-frontend]`):
   - Publishes build artifacts to GitHub Pages.

## Why worldwide FIRMS ingestion runs off-Worker

Worldwide VIIRS thermal hotspot CSVs across 3 sensors (`VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT`) span ~17 MB / 200k+ rows for `24h` (~127 s download wall time, ~3.4 s parse + grid-aggregation CPU) and several times more for `7d`.

Running that ingestion inside a Cloudflare Worker collides with platform limits:
- **Workers Free CPU limit (10 ms per HTTP/cron invocation)**: CSV parsing + spatial aggregation (~3.4 s) and even `JSON.parse` on a monolithic 2.65 MB snapshot (~31 ms per GET) exceed the limit.
- **`ctx.waitUntil` wall-clock cap (~30 s after response)**: On-demand warm-up in a GET handler cannot finish a 120+ second NASA FIRMS download.
- **128 MB isolate memory cap**: Buffering multi-day global CSVs and deduplicating rows in-isolate risks OOM on `7d`.

### Off-Worker architecture (`.github/workflows/firms-ingest.yml` + `backend/scripts/ingest-firms.mjs`)

- **Scheduled GitHub Actions job (`17 */3 * * *`, every 3 hours)** runs `node backend/scripts/ingest-firms.mjs` on Node 22 (no 10 ms CPU or 30 s wall-clock cap).
- Reuses `ingestGlobalFirms` in `backend/src/firmsGlobal.ts`, verifies accounting invariants (`rawRows == malformedRows + outOfWindowRows + duplicateRows + acceptedDetections`), and writes split keys to Cloudflare KV via `wrangler kv bulk put --remote`:
  - `firms:global:meta:v2:<window>` (~400 B metadata + sensor coverage + accounting)
  - `firms:global:cells:v2:<window>` (pre-serialized JSON array of `FireDetectionCell[]`)
  - `firms:global:lkg:meta:v2:<window>` & `firms:global:lkg:cells:v2:<window>` (7-day Last-Known-Good fallback)
- **Zero-parse Worker read path**: `GET /api/v2/disasters` parses only the ~400 B `meta` key, splices the raw `cells` JSON string directly into the response body without `JSON.parse`, and caches the assembled response in the Cloudflare Edge Cache API (`caches.default`) for 5 minutes.
- **Upstream rate & KV write bounds**:
  - NASA FIRMS allows 5,000 requests per 10-minute window.
  - 3 sensors × 2 windows = 6 requests per 3-hour run (48 FIRMS requests/day).
  - 2 bulk KV operations × 8 runs/day = 16 KV bulk operations/day (64 keys written/day), well within Cloudflare KV Free tier (1,000 writes/day).

## Verification levels (do not conflate)

| Level | Meaning |
| --- | --- |
| Locally verified | Unit/integration tests + typecheck/build on this branch |
| Model-probe verified | Bounded `env.AI.run` probe only (not the app route) |
| Application-route verified | Live `POST /api/analyze` with `source: "workers-ai"` |
| Deployed | Worker + Pages published after the coordinated sequence above |

A passing model probe alone is **not** live application acceptance.
