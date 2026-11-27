import type {
	WarningCoverageStatus,
	WarningsApiResponse,
	WarningSourceReport,
} from '../../../shared/contracts';
import { inferNearestGazetteerCountry } from '../../../shared/gazetteer';
import { getAuthoritiesForCountry } from '../../../shared/warningRegistry';
import {
	evaluateAuthorityRecordsForPoint,
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
			const evaluated = evaluateAuthorityRecordsForPoint(snap.doc, options.lat, options.lng, now);
			const matched = evaluated.visibleWarnings;
			const report: WarningSourceReport = {
				sourceId: spec.sourceId,
				authorityName: spec.authorityName,
				countryCodes: spec.countryCodes,
				status: snap.status,
				checkedAt: snap.doc.checkedAt,
				lastSuccessAt: snap.doc.lastSuccessAt,
				activeAlertCount: evaluated.activeRecordCount,
				matchedAlertCount: matched.length,
				unsupportedHazards: spec.unsupportedHazards,
				attribution: spec.attribution,
				termsUrl: spec.termsUrl,
				...(snap.doc.lastError
					? { errorReason: snap.doc.lastError }
					: snap.doc.partialReasons && snap.doc.partialReasons.length > 0
						? { errorReason: `Partial feed (${snap.doc.partialReasons.join(', ')})` }
						: {}),
			};
			return { report, matched };
		}),
	);

	const sources = results.map((r) => r.report);
	const warnings = results.flatMap((r) => r.matched);

	const hasOk = sources.some((s) => s.status === 'ok' || s.status === 'not_modified');
	const hasPartial = sources.some((s) => s.status === 'partial');
	const hasStale = sources.some((s) => s.status === 'stale');
	const hasUnavailable = sources.some((s) => s.status === 'unavailable');

	let coverageStatus: WarningCoverageStatus;
	let coverageExplanation: string;

	if (hasPartial || ((hasOk || hasStale) && hasUnavailable)) {
		coverageStatus = 'partial_coverage';
		coverageExplanation =
			'At least one authority feed or detail item was partially read or temporarily unavailable; missing items are not treated as an all-clear.';
	} else if (hasStale && warnings.length === 0) {
		coverageStatus = 'stale';
		coverageExplanation = 'Upstream warning feed is temporarily unreachable; showing last successfully checked snapshot.';
	} else if (hasStale && warnings.length > 0) {
		coverageStatus = 'stale';
		coverageExplanation = `${warnings.length} warning(s) from last successfully checked snapshot (upstream temporarily unreachable).`;
	} else if (warnings.length > 0 && !hasUnavailable) {
		coverageStatus = 'active_warnings';
		coverageExplanation = `${warnings.length} active official warning(s) match this area.`;
	} else if (warnings.length === 0 && hasOk && !hasUnavailable) {
		coverageStatus = 'checked_no_warnings';
		coverageExplanation = `Checked ${sources.map((s) => s.authorityName).join(', ')} successfully; no active warnings match this location.`;
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
