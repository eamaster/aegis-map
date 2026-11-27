/**
 * Bounded live verification against external official warning & scientific providers.
 * Measures real HTTP status, latency, and schema shape without stressing upstreams.
 *
 * Usage: node scripts/verify-live-providers.mjs
 */

const UA = 'AegisMap/1.5 (https://github.com/eamaster/aegis-map; live-provider-check)';

async function checkEndpoint(name, url, init = {}, validate) {
	const t0 = Date.now();
	try {
		const res = await fetch(url, {
			...init,
			headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
			signal: AbortSignal.timeout(12000),
		});
		const text = await res.text();
		const latencyMs = Date.now() - t0;
		const detail = validate(res.status, text, res.headers);
		return { name, ok: res.ok && detail.valid, status: res.status, latencyMs, detail: detail.summary };
	} catch (err) {
		return {
			name,
			ok: false,
			status: null,
			latencyMs: Date.now() - t0,
			detail: err instanceof Error ? err.message : String(err),
		};
	}
}

async function main() {
	const results = await Promise.all([
		checkEndpoint('MET Norway (MetAlerts 2.0)', 'https://api.met.no/weatherapi/metalerts/2.0/current.json', {}, (status, text) => {
			if (status !== 200) return { valid: false, summary: `HTTP ${status}` };
			const json = JSON.parse(text);
			return { valid: Array.isArray(json.features), summary: `${json.features?.length ?? 0} GeoJSON alerts` };
		}),
		checkEndpoint('MET Malaysia (data.gov.my)', 'https://api.data.gov.my/weather/warning', {}, (status, text) => {
			if (status !== 200) return { valid: false, summary: `HTTP ${status}` };
			const arr = JSON.parse(text);
			return { valid: Array.isArray(arr), summary: `${arr.length ?? 0} records` };
		}),
		checkEndpoint('IRIMO (WMO S3 CAP RSS fa)', 'https://cap-sources.s3.amazonaws.com/ir-irimo-fa/rss.xml', {}, (status, text) => {
			if (status !== 200) return { valid: false, summary: `HTTP ${status}` };
			return { valid: text.includes('<rss') || text.includes('<feed'), summary: `${text.length} bytes RSS` };
		}),
		checkEndpoint('IRIMO Direct (irimo.ir)', 'https://www.irimo.ir/', {}, (status, text) => ({
			valid: status === 200,
			summary: `HTTP ${status} (${text.length} bytes)`,
		})),
		checkEndpoint('India SACHET (CAP RSS)', 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml', {}, (status, text) => {
			if (status !== 200) return { valid: false, summary: `HTTP ${status}` };
			return { valid: text.includes('<rss'), summary: `${text.length} bytes RSS` };
		}),
		checkEndpoint(
			'Copernicus STAC (sentinel-1-grd)',
			'https://stac.dataspace.copernicus.eu/v1/search',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					collections: ['sentinel-1-grd'],
					bbox: [10.3, 59.5, 11.2, 60.2],
					limit: 3,
				}),
			},
			(status, text) => {
				if (status !== 200) return { valid: false, summary: `HTTP ${status}` };
				const json = JSON.parse(text);
				return { valid: Array.isArray(json.features), summary: `${json.features?.length ?? 0} Sentinel-1 scenes` };
			},
		),
		checkEndpoint('USGS Earthquakes (hour)', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson', {}, (status, text) => {
			if (status !== 200) return { valid: false, summary: `HTTP ${status}` };
			const json = JSON.parse(text);
			return { valid: Array.isArray(json.features), summary: `${json.features?.length ?? 0} features` };
		}),
		checkEndpoint('NASA EONET v3 (wildfires)', 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&limit=5', {}, (status, text) => {
			if (status !== 200) return { valid: false, summary: `HTTP ${status}` };
			const json = JSON.parse(text);
			return { valid: Array.isArray(json.events), summary: `${json.events?.length ?? 0} events` };
		}),
		checkEndpoint('CelesTrak TLE (Landsat-8 39084)', 'https://celestrak.org/NORAD/elements/gp.php?CATNR=39084&FORMAT=TLE', {}, (status, text) => {
			if (status !== 200) return { valid: false, summary: `HTTP ${status}` };
			const lines = text.trim().split(/\r?\n/);
			return { valid: lines.length >= 3, summary: `${lines.length} lines` };
		}),
	]);

	console.log('\nLive Provider Verification Summary:');
	for (const r of results) {
		console.log(`  ${r.ok ? 'OK   ' : 'WARN '} ${r.name.padEnd(34)} status=${String(r.status ?? 'ERR').padEnd(4)} ${String(r.latencyMs).padStart(5)}ms  ${r.detail}`);
	}

	// Core pilot & research providers required; irimo.ir direct reachability is informational (covered by WMO S3 mirror)
	const criticalFailures = results.filter(
		(r) => !r.ok && !r.name.startsWith('IRIMO Direct'),
	);
	if (criticalFailures.length > 0) {
		console.error(`\nCritical provider check(s) failed: ${criticalFailures.map((c) => c.name).join(', ')}`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
