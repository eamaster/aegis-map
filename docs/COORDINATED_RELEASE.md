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

Additionally, CI executes an automated smoke check verifying that
`GET /api/v2/disasters?window=24h` returns HTTP 200 on the live Worker before
building and publishing the frontend.

## Deployment pipeline and secrets

The GitHub Actions workflow (`.github/workflows/deploy.yml`) coordinates deployment
in a strict backend-first sequence using Node 22:

1. **`deploy-backend` job**:
   - Runs backend typecheck (`npm run typecheck`) and Vitest test suite (`npm test`).
   - Executes `npx wrangler deploy` to Cloudflare.
   - Requires repository secrets:
     - `CLOUDFLARE_API_TOKEN`: Cloudflare API token with `Workers:Edit` permission.
     - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account identifier.
   - **Important**: `FIRMS_MAP_KEY` remains a Cloudflare Worker secret set via
     `npx wrangler secret put FIRMS_MAP_KEY`. The deploy job preserves existing
     Worker secrets and never overwrites them. Never commit tokens.

2. **`build-frontend` job** (`needs: [deploy-backend]`):
   - Verifies the backend contract (`firms-global-v2` capability).
   - Runs smoke check `GET /api/v2/disasters?window=24h` expecting HTTP 200.
   - Builds frontend with Vite (`npm run build`).
   - Requires repository secrets:
     - `VITE_API_BASE_URL`: Live Worker URL (e.g. `https://aegis-map-backend.smah0085.workers.dev`).
     - `VITE_MAPBOX_TOKEN`: Mapbox public access token.

3. **`deploy-frontend` job** (`needs: [build-frontend]`):
   - Publishes build artifacts to GitHub Pages.

## Upstream limits and call bounds

- NASA FIRMS allows up to 5,000 requests per 10-minute window for MAP_KEY holders.
- AegisMap bounds upstream calls through multi-layer protection:
  - Cache TTL: 24h snapshot cached for 4 hours; 7d snapshot cached for 12 hours.
  - Background warm-up lock: missing snapshots trigger at most 1 background refresh
    per window via a KV lock (`firms:global:lock:v2:<window>`) with 120-second TTL.
  - Cron trigger: scheduled every 2 hours (`23 */2 * * *`).
  - Max upstream calls: 3 sensors × 2 windows = 6 requests per refresh. At a 2-hour cron
    cadence plus on-demand warm-up locks, upstream FIRMS calls are bounded to < 36 calls/hour,
    well within the 5,000 req/10min limit.

## Verification levels (do not conflate)

| Level | Meaning |
| --- | --- |
| Locally verified | Unit/integration tests + typecheck/build on this branch |
| Model-probe verified | Bounded `env.AI.run` probe only (not the app route) |
| Application-route verified | Live `POST /api/analyze` with `source: "workers-ai"` |
| Deployed | Worker + Pages published after the coordinated sequence above |

A passing model probe alone is **not** live application acceptance.
