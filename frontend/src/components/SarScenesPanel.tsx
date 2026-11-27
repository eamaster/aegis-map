import { useEffect, useState } from 'react';
import { Radar, ExternalLink, RefreshCw } from 'lucide-react';
import type { SarSceneItem } from '../../../shared/contracts';
import { fetchSarScenes } from '../utils/researchClient';
import { useDesignSystem } from '../hooks/useDesignSystem';

interface SarScenesPanelProps {
	lat: number;
	lng: number;
	eventDateIso: string;
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

	useEffect(() => {
		const controller = new AbortController();
		const eventMs = Date.parse(eventDateIso);
		const endDate = Number.isFinite(eventMs) ? new Date(Math.min(Date.now(), eventMs + 4 * 86_400_000)) : new Date();
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

	return (
		<section
			data-testid="sar-scenes-panel"
			aria-labelledby="sar-scenes-heading"
			className="rounded-xl p-3.5 border space-y-2.5"
			style={{
				background: ds.surface.overlay,
				borderColor: ds.surface.border,
			}}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
						Confirmed Acquisition (Copernicus STAC)
					</span>
					<h4 id="sar-scenes-heading" className="text-xs font-bold mt-1 flex items-center gap-1.5" style={{ color: ds.text.primary }}>
						<Radar size={13} className="text-emerald-400" aria-hidden="true" />
						<span>Sentinel-1 GRD Acquired Scenes (50 km radius)</span>
					</h4>
				</div>
				<button
					type="button"
					onClick={() => setReloadKey((k) => k + 1)}
					aria-label="Refresh Sentinel-1 scenes"
					className="p-1.5 rounded-lg border text-xs"
					style={{ background: ds.surface.overlaySubtle, borderColor: ds.surface.border, color: ds.text.secondary }}
				>
					<RefreshCw size={12} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
				</button>
			</div>

			{loading ? (
				<p className="text-xs" style={{ color: ds.text.tertiary }}>
					Searching Copernicus Data Space STAC (sentinel-1-grd)...
				</p>
			) : errorMsg ? (
				<p className="text-xs text-amber-300" data-testid="sar-error">
					{errorMsg}
				</p>
			) : scenes.length === 0 ? (
				<p className="text-xs" style={{ color: ds.text.secondary }}>
					No acquired Sentinel-1 GRD scenes found within ±14 days of event window.
				</p>
			) : (
				<div className="space-y-2">
					{cached && (
						<p className="text-[10px]" style={{ color: ds.text.tertiary }}>
							Cached STAC catalog snapshot
						</p>
					)}
					{scenes.map((scene) => (
						<div
							key={scene.id}
							data-testid={`sar-scene-${scene.id}`}
							className="rounded-lg p-2.5 border text-[11px] space-y-1.5"
							style={{ background: ds.surface.overlaySubtle, borderColor: ds.surface.borderSubtle }}
						>
							<div className="flex flex-wrap items-center justify-between gap-1">
								<span className="font-mono font-bold text-[10px] break-all" style={{ color: ds.text.primary }}>
									{scene.id}
								</span>
								<span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
									{scene.instrumentMode ?? 'GRD'}
								</span>
							</div>
							<div className="flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: ds.text.secondary }}>
								<span>Acquired: {scene.datetime.slice(0, 16).replace('T', ' ')} UTC</span>
								<span>Pol: {scene.polarizations.join('/') || 'N/A'}</span>
								{scene.orbitState && <span>Orbit: {scene.orbitState}</span>}
								{scene.incidenceAngleDeg !== null && <span>Incidence: {scene.incidenceAngleDeg}°</span>}
							</div>
							<div className="text-[10px] font-mono" style={{ color: ds.text.tertiary }}>
								BBox: [{scene.bbox.map((n) => n.toFixed(2)).join(', ')}]
							</div>
							<div className="flex flex-wrap gap-3 text-[11px]">
								<a
									href={scene.copernicusBrowserUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-emerald-300 hover:underline font-semibold"
								>
									<span>Copernicus Browser</span>
									<ExternalLink size={11} aria-hidden="true" />
								</a>
								<a
									href={scene.stacItemUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-blue-300 hover:underline font-semibold"
								>
									<span>STAC Item JSON</span>
									<ExternalLink size={11} aria-hidden="true" />
								</a>
							</div>
						</div>
					))}

					{nextToken && (
						<button
							type="button"
							onClick={handleLoadMore}
							disabled={loadingMore}
							className="text-xs font-semibold px-3 py-1 rounded-md border"
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
