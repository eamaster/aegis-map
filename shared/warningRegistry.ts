/**
 * Validated Official Warning Source Registry & Provenance.
 * Provider-specific facts (authority identity, OID, terms/license, feed URLs,
 * languages, supported/unsupported hazards, polling bounds) live here rather
 * than in UI branches.
 */

export interface WarningAuthoritySpec {
	sourceId: string;
	authorityName: string;
	countryCodes: readonly string[];
	wmoOid: string | null;
	wmoRegisterUrl: string | null;
	homepageUrl: string;
	termsUrl: string;
	license: string;
	feedFormat: 'cap_rss_xml' | 'metno_geojson_and_cap' | 'datagovmy_json' | 'sachet_rss_cap_xml';
	feedUrls: readonly string[];
	languages: readonly string[];
	supportedHazards: readonly string[];
	unsupportedHazards: readonly string[];
	attribution: string;
	conditionalFetch: 'etag_or_last_modified' | 'none';
	pollMinIntervalSeconds: number;
	provenanceNote: string;
}

export const WARNING_AUTHORITY_REGISTRY: readonly WarningAuthoritySpec[] = [
	{
		sourceId: 'no-metalerts',
		authorityName: 'Meteorologisk institutt (MET Norway)',
		countryCodes: ['NO', 'SJ'],
		wmoOid: '2.49.0.0.578.0',
		wmoRegisterUrl: 'https://alertingauthority.wmo.int/authorities.php?recId=121',
		homepageUrl: 'https://www.met.no/vaer-og-klima/Ekstremvaervarsler-og-andre-farevarsler',
		termsUrl: 'https://api.met.no/doc/License',
		license: 'NLOD 2.0 / CC BY 4.0',
		feedFormat: 'metno_geojson_and_cap',
		feedUrls: [
			'https://api.met.no/weatherapi/metalerts/2.0/current.json',
			'https://api.met.no/weatherapi/metalerts/2.0/current',
		],
		languages: ['no', 'en'],
		supportedHazards: ['Wind / Gale', 'Heavy Rain', 'Snow / Ice', 'Storm Surge', 'Forest Fire', 'Polar Low'],
		unsupportedHazards: ['Earthquakes (NORSAR)', 'Floods & Landslides (NVE)', 'Tsunami / Nuclear'],
		attribution: 'Data from Meteorologisk institutt (MET Norway) — NLOD 2.0 / CC BY 4.0',
		conditionalFetch: 'etag_or_last_modified',
		pollMinIntervalSeconds: 180,
		provenanceNote: 'Verified live 2026-11-27: MetAlerts 2.0 GeoJSON + CAP v1.2 XML covering Norway mainland, coastal/marine zones, and Svalbard (SJ).',
	},
	{
		sourceId: 'my-metmalaysia',
		authorityName: 'Jabatan Meteorologi Malaysia (MET Malaysia)',
		countryCodes: ['MY'],
		wmoOid: '2.49.0.0.458.0',
		wmoRegisterUrl: null,
		homepageUrl: 'https://www.met.gov.my/',
		termsUrl: 'https://developer.data.gov.my/',
		license: 'CC BY 4.0 (data.gov.my Open API)',
		feedFormat: 'datagovmy_json',
		feedUrls: ['https://api.data.gov.my/weather/warning'],
		languages: ['ms', 'en'],
		supportedHazards: ['Thunderstorms', 'Continuous Rain', 'Strong Winds & Rough Seas', 'Tropical Cyclone Advisories'],
		unsupportedHazards: ['Riverine Flood Evacuation Zones (JPS / InfoBanjir)', 'Landslides (JMG)'],
		attribution: 'Data from Jabatan Meteorologi Malaysia (MET Malaysia) via data.gov.my Open API (CC BY 4.0)',
		conditionalFetch: 'none',
		pollMinIntervalSeconds: 300,
		provenanceNote: 'Verified live 2026-11-27 via api.data.gov.my/weather/warning (bilingual ms/en, Peninsular, Sabah, Sarawak, Labuan & marine). metapi2.met.gov.my requires separate developer credentials.',
	},
	{
		sourceId: 'ir-irimo',
		authorityName: 'Iran Meteorological Organization (IRIMO / سازمان هواشناسی کشور)',
		countryCodes: ['IR'],
		wmoOid: '2.49.0.0.364.0',
		wmoRegisterUrl: 'https://alertingauthority.wmo.int/authorities.php?recId=72',
		homepageUrl: 'https://www.irimo.ir/',
		termsUrl: 'https://severeweather.wmo.int/sources.html',
		license: 'Public Domain (WMO CAP Alert Hub)',
		feedFormat: 'cap_rss_xml',
		feedUrls: [
			'https://cap-sources.s3.amazonaws.com/ir-irimo-fa/rss.xml',
			'https://cap-sources.s3.amazonaws.com/ir-irimo-en/rss.xml',
		],
		languages: ['fa', 'en'],
		supportedHazards: ['Meteorological Warnings (Yellow/Orange/Red)', 'Marine Wind & Waves', 'Dust / Precipitation'],
		unsupportedHazards: ['Earthquakes (IRSC / BHRC)', 'Local Municipal Flood Evacuation Orders'],
		attribution: 'Official CAP alerts from Iran Meteorological Organization (IRIMO) via WMO Severe Weather Alert Hub',
		conditionalFetch: 'etag_or_last_modified',
		pollMinIntervalSeconds: 300,
		provenanceNote: 'WMO recId=72 lists OID 2.49.0.0.364.0 (CAP URL blank on legacy register page); active WMO sources.json routes to cap-sources.s3.amazonaws.com/ir-irimo-{fa,en}/rss.xml (verified live 2026-11-27). Direct www.irimo.ir unreachable from external test network.',
	},
	{
		sourceId: 'in-sachet',
		authorityName: 'National Disaster Management Authority (NDMA India — SACHET)',
		countryCodes: ['IN'],
		wmoOid: '2.49.0.0.356.1',
		wmoRegisterUrl: 'https://severeweather.wmo.int/sources.html',
		homepageUrl: 'https://sachet.ndma.gov.in/',
		termsUrl: 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml',
		license: 'Public Domain (NDMA / C-DOT CAP RSS)',
		feedFormat: 'sachet_rss_cap_xml',
		feedUrls: ['https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml'],
		languages: ['en', 'hi'],
		supportedHazards: ['Multi-Hazard Weather (IMD)', 'Floods (CWC)', 'Ocean State / Tsunami (INCOIS)', 'Avalanche (DGRE)', 'Forest Fire (FSI)', 'SDMA Alerts'],
		unsupportedHazards: ['Earthquakes (NCS)', 'Hyperlocal Block-Level Shelter Capacity'],
		attribution: 'Official CAP alerts from NDMA SACHET (C-DOT / IMD / SDMAs) — Public Domain',
		conditionalFetch: 'etag_or_last_modified',
		pollMinIntervalSeconds: 180,
		provenanceNote: 'Verified live 2026-11-27: All-India CAP RSS supports ETag/Last-Modified and links to FetchXMLFile + FetchPolygonXMLFile.',
	},
];

export interface PlannedExpansionAuthority {
	countryCode: string;
	countryName: string;
	authority: string;
	wmoOid: string;
	feedStandard: string;
	priorityRank: number;
	readinessCriteria: string;
}

/** Ranked global expansion roadmap based on WMO alerting authority records and open CAP feeds. */
export const PLANNED_EXPANSION_AUTHORITIES: readonly PlannedExpansionAuthority[] = [
	{ countryCode: 'US', countryName: 'United States', authority: 'NOAA National Weather Service', wmoOid: '2.49.0.0.840.0', feedStandard: 'CAP v1.2 / NWS GeoJSON API', priorityRank: 1, readinessCriteria: 'Public API; add adapter + NOAA zone geocodes + US contact verification' },
	{ countryCode: 'CA', countryName: 'Canada', authority: 'Environment and Climate Change Canada (ECCC)', wmoOid: '2.49.0.0.124.0', feedStandard: 'CAP-CP XML', priorityRank: 2, readinessCriteria: 'Public MSC Datamart; bilingual en/fr + SGC codes' },
	{ countryCode: 'AU', countryName: 'Australia', authority: 'Bureau of Meteorology (BoM)', wmoOid: '2.49.0.0.36.0', feedStandard: 'CAP-AU / FTP-HTTP XML', priorityRank: 3, readinessCriteria: 'Verify public HTTP CAP mirror + state fire agency links' },
	{ countryCode: 'JP', countryName: 'Japan', authority: 'Japan Meteorological Agency (JMA)', wmoOid: '2.49.0.0.392.0', feedStandard: 'JMA XML / Pull Atom', priorityRank: 4, readinessCriteria: 'Japanese native reviewer + JIS area code table' },
	{ countryCode: 'EU', countryName: 'European Union (Meteoalarm)', authority: 'EUMETNET Meteoalarm Members', wmoOid: 'Multi-OID', feedStandard: 'CAP v1.2 Atom/RSS', priorityRank: 5, readinessCriteria: 'EMMA_ID polygon table + per-country emergency contact verification' },
];

export function getAuthoritiesForCountry(countryCode: string | null | undefined): WarningAuthoritySpec[] {
	if (!countryCode) return [];
	const cc = countryCode.trim().toUpperCase();
	return WARNING_AUTHORITY_REGISTRY.filter((a) => a.countryCodes.includes(cc));
}

export function getAuthorityById(sourceId: string): WarningAuthoritySpec | undefined {
	return WARNING_AUTHORITY_REGISTRY.find((a) => a.sourceId === sourceId);
}
