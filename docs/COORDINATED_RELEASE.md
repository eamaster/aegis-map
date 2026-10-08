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
and requires `version` ≥ `1.2.0` (Workers AI backend). If the check fails,
Pages is **not** published.

## Approved release sequence

1. Deploy backend Worker from this branch (`wrangler deploy`) with AI binding.
2. Verify live: `GET /` → `version: "1.2.0"`; `POST /api/analyze` →
   `source: "workers-ai"` (cache miss then hit).
3. Merge to `main` (or push frontend) so Pages build passes the backend gate.
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
