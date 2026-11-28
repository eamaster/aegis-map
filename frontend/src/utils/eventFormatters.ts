import type { Disaster } from '../types';

export interface HazardMeta {
	icon: string;
	typeLabel: string;
	defaultSource: string;
	accentHex: string;
}

export function getHazardMeta(type: Disaster['type']): HazardMeta {
	switch (type) {
		case 'fire':
			return {
				icon: '🔥',
				typeLabel: 'Wildfire',
				defaultSource: 'NASA EONET',
				accentHex: '#ef4444',
			};
		case 'fire_detection':
			return {
				icon: '🛰️',
				typeLabel: 'Satellite Hotspot Cell',
				defaultSource: 'NASA FIRMS VIIRS',
				accentHex: '#f97316',
			};
		case 'volcano':
			return {
				icon: '🌋',
				typeLabel: 'Volcanic Activity',
				defaultSource: 'NASA EONET',
				accentHex: '#a855f7',
			};
		case 'earthquake':
			return {
				icon: '🌍',
				typeLabel: 'Earthquake',
				defaultSource: 'USGS',
				accentHex: '#f59e0b',
			};
	}
}

export function formatCoordPair(lat: number, lng: number, decimals = 3): string {
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Coordinates unavailable';
	const ns = lat >= 0 ? 'N' : 'S';
	const ew = lng >= 0 ? 'E' : 'W';
	return `${Math.abs(lat).toFixed(decimals)}°${ns}, ${Math.abs(lng).toFixed(decimals)}°${ew}`;
}

export interface FormattedDualTime {
	utc: string;
	local: string;
	valid: boolean;
}

export function resolveIntlLocale(locale?: string): string | undefined {
	if (!locale) return undefined;
	if (locale === 'zh-Hans') return 'zh-CN';
	return locale;
}

export function formatEventDualTime(iso: string | undefined | null, locale?: string): FormattedDualTime {
	if (!iso || typeof iso !== 'string') {
		return { utc: 'Timestamp unavailable', local: '', valid: false };
	}
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) {
		return { utc: iso, local: '', valid: false };
	}
	const d = new Date(ms);
	const utc = `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
	try {
		const local = new Intl.DateTimeFormat(resolveIntlLocale(locale), {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZoneName: 'short',
		}).format(d);
		return { utc, local, valid: true };
	} catch {
		return { utc, local: '', valid: true };
	}
}

export function formatPrimaryMetric(disaster: Disaster): string | null {
	if (disaster.type === 'earthquake' && typeof disaster.magnitude === 'number' && Number.isFinite(disaster.magnitude)) {
		return `M${disaster.magnitude.toFixed(1)}`;
	}
	if (disaster.type === 'fire' && typeof disaster.areaAcres === 'number' && Number.isFinite(disaster.areaAcres)) {
		return `${Math.round(disaster.areaAcres).toLocaleString()} ac`;
	}
	if (disaster.type === 'fire_detection' && disaster.detectionCell) {
		const count = `${disaster.detectionCell.detectionCount.toLocaleString()} detections`;
		const frp =
			disaster.detectionCell.maxFrp !== null && disaster.detectionCell.maxFrp !== undefined
				? ` · Peak FRP ${disaster.detectionCell.maxFrp} MW`
				: '';
		return `${count}${frp}`;
	}
	return null;
}

export function getEventProvenanceLabel(disaster: Disaster): string | null {
	if (disaster.isArchived) {
		return disaster.archiveProvenance === 'reconstructed_backfill'
			? 'Archived · Backfill'
			: 'Archived · Live captured';
	}
	if (disaster.type === 'volcano' && disaster.isHistoricalContext) {
		return 'Open volcanic context';
	}
	return null;
}

/**
 * Pure spherical check for whether `[pointLng, pointLat]` is on the far side of
 * the 3D globe relative to camera center `[centerLng, centerLat]` at `zoom`.
 * At higher zoom levels (>= 5.5), Mapbox transitions from globe to Mercator so
 * viewport bounds govern visibility instead of planetary horizon occlusion.
 */
export function isGlobePointOccluded(
	centerLng: number,
	centerLat: number,
	pointLng: number,
	pointLat: number,
	zoom: number,
): boolean {
	if (zoom >= 5.5) return false;
	if (
		!Number.isFinite(centerLng) ||
		!Number.isFinite(centerLat) ||
		!Number.isFinite(pointLng) ||
		!Number.isFinite(pointLat)
	) {
		return false;
	}
	const toRad = Math.PI / 180;
	const lat1 = centerLat * toRad;
	const lat2 = pointLat * toRad;
	const dLng = (pointLng - centerLng) * toRad;
	const cosAngularDist =
		Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLng);
	// Finite camera altitude horizon cosine (~83 deg angular radius from sub-camera point)
	return cosAngularDist < 0.1;
}

function createBdiElement(text: string, mono = true, doc: Document = document): HTMLElement {
	const bdi = doc.createElement('bdi');
	bdi.setAttribute('dir', 'ltr');
	bdi.style.unicodeBidi = 'isolate';
	if (mono) {
		bdi.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
		bdi.style.fontVariantNumeric = 'tabular-nums';
	}
	bdi.textContent = text;
	return bdi;
}

export interface BuildDisasterPopupOptions {
	mode: 'hover' | 'pinned';
	deselectLabel?: string;
	onClose?: () => void;
	doc?: Document;
}

/**
 * Builds safe DOM content (zero innerHTML) for both hover preview and persistent
 * selected-event map bubbles so hazard units, provenance, and RTL-safe coordinates
 * come from one shared formatter.
 */
export function buildDisasterPopupDom(
	disaster: Disaster,
	options: BuildDisasterPopupOptions,
): HTMLElement {
	const doc = options.doc ?? document;
	const meta = getHazardMeta(disaster.type);
	const metric = formatPrimaryMetric(disaster);
	const provenance = getEventProvenanceLabel(disaster);
	const dualTime = formatEventDualTime(disaster.date);

	const root = doc.createElement('div');
	root.setAttribute('data-testid', options.mode === 'pinned' ? 'pinned-disaster-popup' : 'hover-disaster-popup');
	root.setAttribute('data-disaster-id', disaster.id);
	root.setAttribute('data-popup-mode', options.mode);
	root.style.display = 'flex';
	root.style.flexDirection = 'column';
	root.style.gap = '5px';
	root.style.minWidth = options.mode === 'pinned' ? '210px' : '170px';

	// Header row: Hazard badge + optional provenance + pinned close button
	const headerRow = doc.createElement('div');
	headerRow.style.display = 'flex';
	headerRow.style.alignItems = 'center';
	headerRow.style.justifyContent = 'space-between';
	headerRow.style.gap = '8px';

	const badgeGroup = doc.createElement('div');
	badgeGroup.style.display = 'flex';
	badgeGroup.style.flexWrap = 'wrap';
	badgeGroup.style.alignItems = 'center';
	badgeGroup.style.gap = '4px';

	const typeBadge = doc.createElement('span');
	typeBadge.style.display = 'inline-flex';
	typeBadge.style.alignItems = 'center';
	typeBadge.style.gap = '4px';
	typeBadge.style.padding = '2px 6px';
	typeBadge.style.borderRadius = '5px';
	typeBadge.style.fontSize = '0.65rem';
	typeBadge.style.fontWeight = '800';
	typeBadge.style.letterSpacing = '0.03em';
	typeBadge.style.textTransform = 'uppercase';
	typeBadge.style.background = `${meta.accentHex}24`;
	typeBadge.style.border = `1px solid ${meta.accentHex}66`;
	typeBadge.textContent = `${meta.icon} ${meta.typeLabel}`;
	badgeGroup.appendChild(typeBadge);

	if (provenance) {
		const provBadge = doc.createElement('span');
		provBadge.setAttribute('data-testid', 'popup-provenance-badge');
		provBadge.style.padding = '2px 6px';
		provBadge.style.borderRadius = '5px';
		provBadge.style.fontSize = '0.625rem';
		provBadge.style.fontWeight = '700';
		provBadge.style.background = 'rgba(59, 130, 246, 0.18)';
		provBadge.style.border = '1px solid rgba(96, 165, 250, 0.45)';
		provBadge.textContent = provenance;
		badgeGroup.appendChild(provBadge);
	}

	headerRow.appendChild(badgeGroup);

	if (options.mode === 'pinned' && options.onClose) {
		const closeBtn = doc.createElement('button');
		closeBtn.type = 'button';
		closeBtn.setAttribute('data-testid', 'close-pinned-popup-btn');
		closeBtn.setAttribute('aria-label', options.deselectLabel || 'Close event inspector and deselect');
		closeBtn.style.minWidth = '28px';
		closeBtn.style.minHeight = '28px';
		closeBtn.style.padding = '4px 7px';
		closeBtn.style.borderRadius = '6px';
		closeBtn.style.border = '1px solid var(--color-border)';
		closeBtn.style.background = 'var(--color-surface-subtle)';
		closeBtn.style.color = 'var(--popup-text)';
		closeBtn.style.fontWeight = '800';
		closeBtn.style.fontSize = '0.85rem';
		closeBtn.style.lineHeight = '1';
		closeBtn.style.flexShrink = '0';
		closeBtn.textContent = '×';
		closeBtn.addEventListener('click', (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			options.onClose?.();
		});
		headerRow.appendChild(closeBtn);
	}

	root.appendChild(headerRow);

	// Title
	const titleEl = doc.createElement('div');
	titleEl.setAttribute('data-testid', 'popup-event-title');
	titleEl.style.fontWeight = '800';
	titleEl.style.fontSize = '0.8125rem';
	titleEl.style.lineHeight = '1.3';
	titleEl.style.wordBreak = 'break-word';
	titleEl.textContent =
		disaster.type === 'fire_detection' ? 'Satellite Thermal Hotspots Cell' : disaster.title;
	root.appendChild(titleEl);

	// Metric + source line
	const metaRow = doc.createElement('div');
	metaRow.style.display = 'flex';
	metaRow.style.flexWrap = 'wrap';
	metaRow.style.alignItems = 'center';
	metaRow.style.gap = '6px';
	metaRow.style.fontSize = '0.72rem';
	metaRow.style.color = 'var(--popup-muted)';

	if (metric) {
		const metricSpan = doc.createElement('span');
		metricSpan.style.fontWeight = '700';
		metricSpan.style.color = 'var(--popup-text)';
		metricSpan.appendChild(createBdiElement(metric, false, doc));
		metaRow.appendChild(metricSpan);
	}

	const srcSpan = doc.createElement('span');
	srcSpan.textContent = `${metric ? '· ' : ''}${disaster.archiveAttribution || meta.defaultSource}`;
	metaRow.appendChild(srcSpan);
	root.appendChild(metaRow);

	if (disaster.type === 'fire_detection') {
		const caveatEl = doc.createElement('div');
		caveatEl.style.fontSize = '0.65rem';
		caveatEl.style.color = 'var(--popup-muted)';
		caveatEl.textContent = 'Sensor thermal signature — not a confirmed ground perimeter';
		root.appendChild(caveatEl);
	}

	// Timestamp & coordinates (always LTR-isolated for RTL locales)
	const coordsAndTime = doc.createElement('div');
	coordsAndTime.style.display = 'flex';
	coordsAndTime.style.flexDirection = 'column';
	coordsAndTime.style.gap = '2px';
	coordsAndTime.style.fontSize = '0.675rem';
	coordsAndTime.style.color = 'var(--popup-muted)';
	coordsAndTime.style.paddingTop = '3px';
	coordsAndTime.style.borderTop = '1px solid var(--color-border-subtle)';

	if (dualTime.valid) {
		coordsAndTime.appendChild(createBdiElement(dualTime.utc, true, doc));
	}
	if (options.mode === 'pinned') {
		coordsAndTime.appendChild(createBdiElement(formatCoordPair(disaster.lat, disaster.lng, 3), true, doc));
	}
	root.appendChild(coordsAndTime);

	return root;
}
