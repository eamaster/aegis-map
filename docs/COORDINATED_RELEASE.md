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
- `provider-status-v1` (from `1.3.0`): FIRMS coverage windows and
  `firms_unavailable` 502, `X-Disaster-*` source headers, `X-TLE-*` headers.

A `1.2.0` backend reports no capabilities, so it cannot satisfy the gate. If
the check fails, Pages is **not** published; the source merge itself is
unaffected. Add a new capability whenever the frontend starts depending on a
backend behavior an older deployment lacks, in both the config and the
workflow's required list.

## Approved release sequence

1. Deploy backend Worker from `main` (`wrangler deploy`) with AI binding.
2. Verify live: `GET /` → `version: "1.3.0"` with both capabilities;
   `POST /api/analyze` → `source: "workers-ai"` (cache miss then hit).
3. Re-run the Pages workflow (`workflow_dispatch` is not configured, so push a
   frontend change or re-run the failed run) so the build passes the gate.
4. Optionally remove obsolete Cloudflare secret `GEMINI_API_KEY` (manual).

## Abuse controls (release blocker if unmet)

CORS allowlisting is not authentication. Before public production reliance on
inference, configure at least one free-plan-compatible control, e.g.:

- Cloudflare WAF rate limiting / bot fight on `/api/analyze`, or
- Workers rate limiting / custom short-circuit when Neurons quota errors recur.

Do not enable paid plans without separate approval.

## Verification levels (do not conflate)

| Level | Meaning |
| --- | --- |
| Locally verified | Unit/integration tests + typecheck/build on this branch |
| Model-probe verified | Bounded `env.AI.run` probe only (not the app route) |
| Application-route verified | Live `POST /api/analyze` with `source: "workers-ai"` |
| Deployed | Worker + Pages published after the coordinated sequence above |

A passing model probe alone is **not** live application acceptance.
