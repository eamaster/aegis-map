import { useEffect, useState } from 'react';
import { Radar, ExternalLink, RefreshCw, Copy, Check } from 'lucide-react';
import type { SarSceneItem } from '../../../shared/contracts';
import { fetchSarScenes } from '../utils/researchClient';
import { useDesignSystem } from '../hooks/useDesignSystem';
import { BdiLtr } from './BdiLtr';

interface SarScenesPanelProps {
	lat: number;
	lng: number;
	eventDateIso: string;
}

function formatUtcTimestamp(iso: string | undefined | null): string | null {
	if (!iso || typeof iso !== 'string') return null;
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return null;
	return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default function SarScenesPanel({ lat, lng, eventDateIso }: SarScenesPanelProps) {
	const ds = useDesignSystem();
	const [scenes, setScenes] = useState<SarSceneItem[]>([]);
	const [nextToken, setNextToken] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [cached, setCached] = useState(false);
	const [reloadKey, setReloadKey] = useState(0);
	const [copiedId, setCopiedId] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		const eventMs = Date.parse(eventDateIso);
		const endDate = Number.isFinite(eventMs)
			? new Date(Math.min(Date.now(), eventMs + 4 * 86_400_000))
			: new Date();
		const startDate = new Date(endDate.getTime() - 14 * 86_400_000);

		const timer = window.setTimeout(async () => {
			setLoading(true);
			setErrorMsg(null);
			try {
				const res = await fetchSarScenes({
					lat,
					lng,
					startIso: startDate.toISOString(),
					endIso: endDate.toISOString(),
					signal: controller.signal,
				});
				setScenes(res.scenes);
				setNextToken(res.nextToken);
				setCached(res.cached);
			} catch (err) {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				setScenes([]);
				setNextToken(null);
				setErrorMsg(err instanceof Error ? err.message : 'Unable to query Copernicus STAC');
			} finally {
				setLoading(false);
			}
		}, 0);

		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	}, [lat, lng, eventDateIso, reloadKey]);

	const handleLoadMore = async () => {
		if (!nextToken || loadingMore) return;
		setLoadingMore(true);
		try {
			const res = await fetchSarScenes({ lat, lng, token: nextToken });
			setScenes((prev) => {
				const existing = new Set(prev.map((s) => s.id));
				const merged = [...prev];
				for (const item of res.scenes) {
					if (!existing.has(item.id)) merged.push(item);
				}
				return merged;
			});
			setNextToken(res.nextToken);
		} catch (err) {
			setErrorMsg(err instanceof Error ? err.message : 'Pagination request failed');
		} finally {
			setLoadingMore(false);
		}
	};

	const copySceneId = async (id: string) => {
		try {
			await navigator.clipboard.writeText(id);
			setCopiedId(id);
			window.setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000);
		} catch {
			// Ignore clipboard permission failure
		}
	};

	const reportedEventUtc = formatUtcTimestamp(eventDateIso);

	return (
		<section
			data-testid="sar-scenes-panel"
			aria-labelledby="sar-scenes-heading"
			className="rounded-xl p-3.5 border space-y-2.5 overflow-hidden"
			style={{
				background: ds.surface.overlay,
				borderColor: ds.surface.border,
			}}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
						Confirmed Acquisition (Copernicus STAC)
					</span>
					<h4
						id="sar-scenes-heading"
						className="text-xs font-bold mt-1.5 flex items-center gap-1.5"
						style={{ color: ds.text.primary }}
					>
						<Radar size={13} className="text-emerald-400 shrink-0" aria-hidden="true" />
						<span>Sentinel-1 Radar Scenes (50 km radius)</span>
					</h4>
				</div>
				<button
					type="button"
					onClick={() => setReloadKey((k) => k + 1)}
					aria-label="Refresh Sentinel-1 scenes"
					className="min-h-[34px] min-w-[34px] shrink-0 rounded-lg border flex items-center justify-center"
					style={{
						background: ds.surface.overlaySubtle,
						borderColor: ds.surface.border,
						color: ds.text.secondary,
					}}
				>
					<RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
				</button>
			</div>

			{reportedEventUtc && (
				<p className="text-[11px]" style={{ color: ds.text.tertiary }}>
					Reported event date: <BdiLtr mono>{reportedEventUtc}</BdiLtr>
				</p>
			)}

			{loading ? (
				<p className="text-xs" style={{ color: ds.text.tertiary }}>
					Searching Copernicus Data Space STAC (sentinel-1-grd)…
				</p>
			) : errorMsg ? (
				<p className="text-xs text-amber-400 font-medium" data-testid="sar-error">
					{errorMsg}
				</p>
			) : scenes.length === 0 ? (
				<p className="text-xs" style={{ color: ds.text.secondary }} data-testid="sar-empty">
					No acquired Sentinel-1 GRD scenes found within ±14 days of event window.
				</p>
			) : (
				<div className="space-y-2">
					{cached && (
						<p className="text-[10px]" style={{ color: ds.text.tertiary }}>
							Cached STAC catalog snapshot
						</p>
					)}
					{scenes.map((scene) => {
						const acqUtc = formatUtcTimestamp(scene.datetime);
						const modeLabel = scene.instrumentMode || 'GRD';
						const polLabel = scene.polarizations.join('/') || 'N/A';

						return (
							<div
								key={scene.id}
								data-testid={`sar-scene-${scene.id}`}
								className="rounded-lg p-3 border text-xs space-y-2 min-w-0 overflow-hidden"
								style={{
									background: ds.surface.overlaySubtle,
									borderColor: ds.surface.borderSubtle,
								}}
							>
								{/* Human-readable headline: Sensor + Mode + Acquisition Time */}
								<div className="flex flex-wrap items-center justify-between gap-1.5">
									<div className="font-bold min-w-0" style={{ color: ds.text.primary }}>
										<span>Sentinel-1 {modeLabel}</span>
										<span className="mx-1.5 opacity-50">·</span>
										{acqUtc ? (
											<BdiLtr mono>{acqUtc}</BdiLtr>
										) : (
											<span style={{ color: ds.text.tertiary }}>
												Unknown acquisition date
											</span>
										)}
									</div>
									<span className="uppercase text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
										<BdiLtr>{polLabel}</BdiLtr>
									</span>
								</div>

								{/* Key radar geometry metadata */}
								<div
									className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]"
									style={{ color: ds.text.secondary }}
								>
									{scene.orbitState && <span>Orbit: {scene.orbitState}</span>}
									{scene.incidenceAngleDeg !== null && (
										<span>
											Incidence: <BdiLtr mono>{scene.incidenceAngleDeg}°</BdiLtr>
										</span>
									)}
									{reportedEventUtc && acqUtc && (
										<span style={{ color: ds.text.tertiary }}>
											Event: <BdiLtr mono>{reportedEventUtc.slice(0, 10)}</BdiLtr>
										</span>
									)}
								</div>

								{/* Action links */}
								<div className="flex flex-wrap items-center gap-3 text-[11px] pt-0.5">
									<a
										href={scene.copernicusBrowserUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="min-h-[32px] inline-flex items-center gap-1 text-emerald-400 hover:underline font-bold"
									>
										<span>Copernicus Browser</span>
										<ExternalLink size={11} aria-hidden="true" />
									</a>
									<a
										href={scene.stacItemUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="min-h-[32px] inline-flex items-center gap-1 text-blue-400 hover:underline font-bold"
									>
										<span>STAC Item JSON</span>
										<ExternalLink size={11} aria-hidden="true" />
									</a>
								</div>

								{/* Technical Scene ID & Footprint BBox inside Details with Copy action */}
								<details
									data-testid="sar-scene-details"
									className="pt-1 border-t text-[11px]"
									style={{ borderColor: ds.surface.borderSubtle }}
								>
									<summary
										className="font-semibold select-none py-1"
										style={{ color: ds.text.tertiary }}
									>
										Scene ID & footprint details
									</summary>
									<div className="mt-1.5 space-y-1.5 min-w-0">
										<div className="flex items-start justify-between gap-2 min-w-0">
											<BdiLtr
												mono
												className="text-[10px] break-all leading-relaxed flex-1 min-w-0"
											>
												{scene.id}
											</BdiLtr>
											<button
												type="button"
												data-testid={`copy-sar-id-${scene.id}`}
												onClick={() => void copySceneId(scene.id)}
												className="min-h-[30px] shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-bold"
												style={{
													background: ds.surface.overlay,
													borderColor: ds.surface.border,
													color: ds.text.primary,
												}}
												aria-label="Copy Sentinel-1 scene ID"
											>
												{copiedId === scene.id ? (
													<>
														<Check size={11} aria-hidden="true" />
														<span>Copied</span>
													</>
												) : (
													<>
														<Copy size={11} aria-hidden="true" />
														<span>Copy ID</span>
													</>
												)}
											</button>
										</div>
										{Array.isArray(scene.bbox) && scene.bbox.length === 4 && (
											<div className="text-[10px]" style={{ color: ds.text.tertiary }}>
												BBox:{' '}
												<BdiLtr mono>
													[{scene.bbox.map((n) => Number(n).toFixed(2)).join(', ')}]
												</BdiLtr>
											</div>
										)}
									</div>
								</details>
							</div>
						);
					})}

					{nextToken && (
						<button
							type="button"
							onClick={handleLoadMore}
							disabled={loadingMore}
							className="min-h-[36px] text-xs font-semibold px-3 py-1.5 rounded-lg border"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: ds.surface.border,
								color: ds.colors.accent.blueLight,
							}}
						>
							{loadingMore ? 'Loading more…' : 'Load more Sentinel-1 scenes'}
						</button>
					)}
				</div>
			)}
		</section>
	);
}
