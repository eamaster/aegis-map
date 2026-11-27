# AegisMap v1.5 Coverage Matrix, Infrastructure Budget & Operations Runbook

## 1. Resident Official Warning Registry & Verified Coverage

Source facts (URLs, terms, languages, hazards, attribution) are centralized in [shared/warningRegistry.ts](../shared/warningRegistry.ts) rather than hardcoded in UI branches.

| Country | Authority (`sourceId`) | WMO OID | Feed Format & Endpoint | Languages | Covered Hazards | Explicit Exclusions / Gaps | Verification Status |
|---|---|---|---|---|---|---|---|
| Norway / Svalbard (`NO`, `SJ`) | Meteorologisk institutt (`no-metalerts`) | `2.49.0.0.578.0` | MetAlerts 2.0 GeoJSON (`api.met.no/weatherapi/metalerts/2.0/current.json`) + CAP RSS | `no`, `en` | Wind / Gale, Heavy Rain, Snow / Ice, Storm Surge, Forest Fire, Polar Low | Earthquakes (NORSAR), Floods & Landslides (NVE), Tsunami / Nuclear | **Verified live** (`200 OK`, NLOD 2.0 / CC BY 4.0) |
| Malaysia (`MY`) | MET Malaysia (`my-metmalaysia`) | `2.49.0.0.458.0` | Open API JSON (`api.data.gov.my/weather/warning`) | `ms`, `en` | Thunderstorm, Continuous Rain, Strong Winds & Rough Seas | No polygon geometry in `data.gov.my` feed (state/water-text matched with `matchUncertain: true`); Earthquakes/Tsunami covered separately | **Verified live** (`200 OK`, CC BY 4.0). *Gap:* `metapi2.met.gov.my` requires registered developer API key. |
| Iran (`IR`) | I.R. of Iran Meteorological Organization (`ir-irimo`) | `2.49.0.0.364.0` | WMO Alert Hub CAP v1.2 RSS (`cap-sources.s3.amazonaws.com/ir-irimo-fa/rss.xml` & `ir-irimo-en/rss.xml`) | `fa`, `en` | Meteorological, Wind, Heavy Precipitation, Dust, Cold/Frost | Floods (Ministry of Energy), Earthquakes (IIEES) | **Verified via WMO CAP S3 mirror** (`200 OK`, CAP XML `2026-11-25`). *Live-access gap:* Direct `https://www.irimo.ir/` timed out (`fetch failed`, `~10.6s`) from external cloud networks and WMO legacy `recId=72` HTML omits the feed URL. Native Persian emergency-copy review pending. |
| India (`IN`) | NDMA India SACHET (`in-sachet`) | `2.49.0.0.356.0` | CAP v1.2 RSS (`sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml`) + `FetchXMLFile` + `FetchPolygonXMLFile` | `en`, regional CAP blocks | Heavy Rain, Thunderstorm, Heatwave, Cyclone, Flood, Landslide, Avalanche | Local municipal advisories not syndicated to NDMA SACHET | **Verified live** (`200 OK`, `ETag` conditional fetch + polygon hydration) |
| All other countries | — | — | Explicit `unsupported_jurisdiction` status | `en` / `fa` / `ms` UI | None claimed | Emergency contacts + manual GPS/coordinates + Research view stay accessible | Planned via WMO expansion roadmap below |

### Planned WMO Global Expansion Ranking

1. **United States (`US`)** — NOAA National Weather Service (`2.49.0.0.840.0`), public CAP v1.2 / GeoJSON API.
2. **Canada (`CA`)** — ECCC (`2.49.0.0.124.0`), bilingual `en`/`fr` CAP-CP MSC Datamart.
3. **Australia (`AU`)** — Bureau of Meteorology (`2.49.0.0.36.0`), CAP-AU XML.
4. **Japan (`JP`)** — Japan Meteorological Agency (`2.49.0.0.392.0`), requires native reviewer & JIS codes.
5. **European Union (`EU`)** — EUMETNET Meteoalarm CAP Atom/RSS + EMMA_ID polygons.

---

## 2. Emergency Contacts & ITU Verification Table

Verified national emergency numbers in [shared/emergencyContacts.ts](../shared/emergencyContacts.ts) are always resolved for the resident's **confirmed present physical jurisdiction** (`presentJurisdiction`), strictly separated from the monitored place. AegisMap never claims responder dispatch confirmation — `tel:` and Web Share handoff only invoke the user's device app.

| Country | Verified Numbers (Cross-Checked Against Local Authorities & ITU-T E.129 / Official Portals) | Authority Reference |
|---|---|---|
| Malaysia (`MY`) | `999` (MERS 999 All-Emergency), `112` (Mobile GSM) | mers999.gov.my / ITU E.129 |
| Norway & Svalbard (`NO`, `SJ`) | `110` (Fire), `112` (Police), `113` (Medical), `112` (Governor of Svalbard Rescue) | regjeringen.no / sysselmesteren.no |
| Iran (`IR`) | `115` (Medical EMS), `125` (Fire & Rescue), `110` (Police), `112` (Red Crescent), `129` (Crisis) | Iranian Red Crescent (rcs.ir) / National Emergency Org |
| India (`IN`) | `112` (ERSS National Emergency), `1078` (NDMA Disaster Management) | 112.gov.in / ndma.gov.in |
| US (`US`) | `911` | 911.gov / FCC |
| UK (`GB`) | `999`, `112` | gov.uk |
| Australia (`AU`) | `000`, `112` | triplezero.gov.au |
| Singapore (`SG`) | `999` (Police), `995` (SCDF Fire/Ambulance) | scdf.gov.sg / spf.gov.sg |

Any country outside the verified registry returns `verified: false` with empty clickable `tel:` numbers and explicit instructions to confirm local numbers before traveling or during emergencies.

---

## 3. Epistemic Boundaries (Resident vs Researcher Data)

- **Official Warnings (`Near me`)**: Authoritative public safety advisories via `/api/v1/warnings`. No Workers AI call is made or permitted to rewrite evacuation instructions.
- **Predicted Overpasses (`Explore events`)**: SGP4 propagation snapshots from CelesTrak TLEs (`PassComparisonPanel`, `.ics` export labeled `SNAPSHOT ONLY`). Predicted elevation does **not** prove sensor imaging occurred.
- **Confirmed Acquisitions (`Explore events`)**:
  - Optical/Thermal reference tiles from NASA GIBS (`SatelliteImagery`) & VIIRS 375 m hotspots (`/api/fire-hotspots`).
  - Sentinel-1 C-band SAR Ground Range Detected (GRD) acquisitions from Copernicus Data Space STAC (`/api/v1/sar-scenes`).
- **Derived Interpretations (`Explore events`)**: Workers AI (`POST /api/analyze`) two-sentence metadata guidance grounded in predicted pass + weather + fleet sensor table.

---

## 4. Cloudflare Account Resource & Cost Budget

Evaluated against Cloudflare Workers Free + D1 + KV quotas on account `767ce92674d0bd477eef696c995faf16`:

| Resource | Usage Pattern & Bounds | Free Tier Headroom | Privacy & Operational Controls |
|---|---|---|---|
| **Workers CPU & Wall Time** | `/api/v2/disasters` splices raw `cells` JSON without parsing (`<2 ms` CPU); FIRMS bulk ingest runs off-Worker on GitHub Actions; warnings/SAR/history enforce 8–12 s fetch timeouts. | Well under 10 ms CPU average / 100k req/day Free limit. | Non-blocking `ctx.waitUntil` for D1 live event recording & SWR TLE refresh. |
| **Workers KV (`AEGIS_CACHE`)** | Read-heavy snapshots (`disasters`, `firms:global:meta/cells`, `tles`, `warnings:source:v1:*`, `sar:stac:v1:*`, `sub:sent:*` 7d receipt). Max ~70 writes/day from cron + ingest. | Free tier: 100k reads/day, 1k writes/day, 1 GB storage. | **No personal coordinates or emails stored in KV.** User location queries set `Cache-Control: private, no-store`. |
| **Cloudflare D1 (`AEGIS_DB`)** | Indexed tables (`disaster_events`, `disaster_revisions`, `ingestion_checkpoints`, `provider_health_runs`, `subscriptions`, `subscription_deliveries`). Bounded `LIMIT 25..200` queries. | Free tier: 5M rows read/day, 100k rows written/day, 5 GB total DB. | Subscription lat/lng rounded to `0.001°` (`~110 m`); email double opt-in required; `UNIQUE(subscription_id, alert_id, alert_revision_sent_at)` outbox dedup. |
| **Workers AI (`AI`)** | `@cf/google/gemma-4-26b-a4b-it`, cached 2 h per event/pass/cloud tuple; not invoked in `Near me`. | Free 10,000 Neurons/day allocation. | Fails visibly with structured error codes without hallucinating warnings. |
| **Email / SMS Delivery** | Sandbox transport active when `RESEND_API_KEY` is unset (`sandboxPreviewToken` only returned in sandbox mode). Live delivery uses Resend API with `Idempotency-Key`. | Resend free tier: 3,000 emails/mo. Regional SMS returns explicit **`501 sms_deferred`** (`code: "sms_deferred"`) until carrier cost limits & verified delivery callbacks are funded. | Preview/CI environments keep `RESEND_API_KEY` unset to guarantee zero real external sends. |
| **Offline PWA Cache (`sw.js`)** | Precaches HTML shell, manifest, and static JS/CSS; excludes Mapbox tiles, Esri tiles, NASA GIBS imagery, and API mutations. | Respects third-party Mapbox/GIBS tile license terms. | Explicit "Clear Saved Places & Offline Data" button wipes `localStorage` + offline notice cache. |

---

## 5. D1 Migration, Backfill & Rollback Runbook

```bash
# 1. Apply schema migration (isolated preview first, then production during cutover)
cd backend
npx wrangler d1 migrations apply AEGIS_DB --remote --env preview

# 2. Seed initial bounded historical archive (last 7-14 days USGS + EONET + optional GDACS)
node scripts/backfill-history.mjs --days 7 --limit 40 --remote --env preview

# 3. Deploy Worker with traceable commit SHA
npx wrangler deploy --env preview --var GIT_SHA:$(git rev-parse HEAD)

# 4. Rollback Worker to previous verified deployment if smoke checks fail
npx wrangler rollback --env preview -y
```
