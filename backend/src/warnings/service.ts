import type {
	OfficialWarningItem,
	WarningCoverageStatus,
	WarningsApiResponse,
	WarningSourceReport,
} from '../../../shared/contracts';
import { inferNearestGazetteerCountry } from '../../../shared/gazetteer';
import { getAuthoritiesForCountry } from '../../../shared/warningRegistry';
import {
	matchStoredRecordToPoint,
	refreshOrLoadAuthoritySnapshot,
	type FetchLike,
} from './adapters';

export async function queryOfficialWarnings(options: {
	lat: number;
	lng: number;
	countryCode?: string | null;
	kv?: KVNamespace;
	fetchImpl?: FetchLike;
	now?: Date;
	forceRefresh?: boolean;
}): Promise<WarningsApiResponse> {
	const now = options.now ?? new Date();
	const explicitCc = options.countryCode?.trim().toUpperCase() || null;
	const inferred = explicitCc ? null : inferNearestGazetteerCountry(options.lat, options.lng, 6.0);
	const resolvedCountry = explicitCc ?? inferred?.countryCode ?? null;

	const authorities = getAuthoritiesForCountry(resolvedCountry);
	if (authorities.length === 0) {
		return {
			version: 1,
			query: {
				lat: options.lat,
				lng: options.lng,
				countryCode: resolvedCountry,
				checkedAt: now.toISOString(),
			},
			coverageStatus: 'unsupported_jurisdiction',
			coverageExplanation: resolvedCountry
				? `No official alerting authority adapter is enabled yet for country ${resolvedCountry}.`
				: 'Country jurisdiction could not be determined from these coordinates; select a country or place manually.',
			warnings: [],
			sources: [],
		};
	}

	const results = await Promise.all(
		authorities.map(async (spec) => {
			const snap = await refreshOrLoadAuthoritySnapshot(spec, {
				kv: options.kv,
				fetchImpl: options.fetchImpl,
				now,
				forceRefresh: options.forceRefresh,
			});
			const matched: OfficialWarningItem[] = [];
			for (const rec of snap.doc.records) {
				const m = matchStoredRecordToPoint(rec, options.lat, options.lng, now);
				if (m) matched.push(m);
			}
			const report: WarningSourceReport = {
				sourceId: spec.sourceId,
				authorityName: spec.authorityName,
				countryCodes: spec.countryCodes,
				status: snap.status,
				checkedAt: snap.doc.checkedAt,
				lastSuccessAt: snap.doc.lastSuccessAt,
				activeAlertCount: snap.doc.records.length,
				matchedAlertCount: matched.length,
				unsupportedHazards: spec.unsupportedHazards,
				attribution: spec.attribution,
				termsUrl: spec.termsUrl,
				...(snap.doc.lastError ? { errorReason: snap.doc.lastError } : {}),
			};
			return { report, matched };
		}),
	);

	const sources = results.map((r) => r.report);
	const warnings = results.flatMap((r) => r.matched);

	const hasOk = sources.some((s) => s.status === 'ok' || s.status === 'not_modified');
	const hasStale = sources.some((s) => s.status === 'stale');
	const hasUnavailable = sources.some((s) => s.status === 'unavailable');

	let coverageStatus: WarningCoverageStatus;
	let coverageExplanation: string;

	if (warnings.length > 0 && !hasUnavailable && !hasStale) {
		coverageStatus = 'active_warnings';
		coverageExplanation = `${warnings.length} active official warning(s) match this area.`;
	} else if (warnings.length === 0 && hasOk && !hasUnavailable && !hasStale) {
		coverageStatus = 'checked_no_warnings';
		coverageExplanation = `Checked ${sources.map((s) => s.authorityName).join(', ')} successfully; no active warnings match this location.`;
	} else if ((hasOk || hasStale) && hasUnavailable) {
		coverageStatus = 'partial_coverage';
		coverageExplanation = 'At least one authority source is temporarily unavailable; displayed coverage is partial.';
	} else if (hasStale) {
		coverageStatus = 'stale';
		coverageExplanation = 'Upstream warning feed is temporarily unreachable; showing last successfully checked snapshot.';
	} else {
		coverageStatus = 'source_unavailable';
		coverageExplanation = 'Configured official warning source(s) could not be reached. Do not assume an all-clear.';
	}

	return {
		version: 1,
		query: {
			lat: options.lat,
			lng: options.lng,
			countryCode: resolvedCountry,
			checkedAt: now.toISOString(),
		},
		coverageStatus,
		coverageExplanation,
		warnings,
		sources,
	};
}
