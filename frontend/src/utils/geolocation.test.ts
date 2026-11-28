import { describe, expect, it, vi } from 'vitest';
import { acquireUserLocation, resolveGpsPlaceWithUncertainty } from './geolocation';

describe('Desktop & mobile geolocation strategy', () => {
	it('accepts a fast coarse fix on stage 1 when accuracy <= 5000m without waiting for high-accuracy GPS', async () => {
		const calls: PositionOptions[] = [];
		const geo: Pick<Geolocation, 'getCurrentPosition'> = {
			getCurrentPosition(success, _err, opts) {
				calls.push(opts ?? {});
				success({
					coords: {
						latitude: 3.139,
						longitude: 101.6869,
						accuracy: 1200,
						altitude: null,
						altitudeAccuracy: null,
						heading: null,
						speed: null,
						toJSON: () => ({}),
					},
					timestamp: 1_764_300_000_000,
					toJSON: () => ({}),
				});
			},
		};

		const res = await acquireUserLocation({ geo, isSecureContext: true });
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.fix.stage).toBe('coarse');
			expect(res.fix.accuracy).toBe(1200);
		}
		expect(calls).toHaveLength(1);
		expect(calls[0].enableHighAccuracy).toBe(false);
	});

	it('attempts stage 2 refinement when coarse accuracy > 5000m and preserves coarse fix if refinement times out', async () => {
		const onCoarse = vi.fn();
		let attempt = 0;
		const geo: Pick<Geolocation, 'getCurrentPosition'> = {
			getCurrentPosition(success, error) {
				attempt++;
				if (attempt === 1) {
					success({
						coords: {
							latitude: 59.9139,
							longitude: 10.7522,
							accuracy: 9000,
							altitude: null,
							altitudeAccuracy: null,
							heading: null,
							speed: null,
							toJSON: () => ({}),
						},
						timestamp: 1_764_300_000_000,
						toJSON: () => ({}),
					});
				} else {
					error?.({
						code: 3,
						message: 'Timeout',
						PERMISSION_DENIED: 1,
						POSITION_UNAVAILABLE: 2,
						TIMEOUT: 3,
					});
				}
			},
		};

		const res = await acquireUserLocation({ geo, isSecureContext: true, onCoarseFix: onCoarse });
		expect(onCoarse).toHaveBeenCalledTimes(1);
		expect(attempt).toBe(2);
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.fix.stage).toBe('coarse');
			expect(res.fix.latitude).toBe(59.9139);
		}
	});

	it('fails fast on PERMISSION_DENIED and rejects insecure non-HTTPS contexts', async () => {
		const insecure = await acquireUserLocation({ isSecureContext: false, geo: null });
		expect(insecure).toEqual({ ok: false, code: 'insecure_context' });

		let attempt = 0;
		const deniedGeo: Pick<Geolocation, 'getCurrentPosition'> = {
			getCurrentPosition(_s, error) {
				attempt++;
				error?.({
					code: 1,
					message: 'Denied',
					PERMISSION_DENIED: 1,
					POSITION_UNAVAILABLE: 2,
					TIMEOUT: 3,
				});
			},
		};
		const denied = await acquireUserLocation({ geo: deniedGeo, isSecureContext: true });
		expect(denied).toEqual({ ok: false, code: 'permission_denied' });
		expect(attempt).toBe(1);
	});

	it('flags country uncertainty near borders (MY/SG Johor Bahru-Singapore) or far offshore points', () => {
		// Johor Bahru (1.4927, 103.7414) is ~18km from Singapore (1.3521, 103.8198) -> border ambiguous!
		const border = resolveGpsPlaceWithUncertainty(1.42, 103.78, 500, 1_764_300_000_000);
		expect(border.countryUncertain).toBe(true);
		expect(border.place.countryCode).toBeNull();

		// Central Kuala Lumpur (3.139, 101.687) -> unambiguous Malaysia
		const kl = resolveGpsPlaceWithUncertainty(3.139, 101.687, 300, 1_764_300_000_000);
		expect(kl.countryUncertain).toBe(false);
		expect(kl.place.countryCode).toBe('MY');

		// Mid-Pacific offshore point -> unambiguous uncertainty
		const offshore = resolveGpsPlaceWithUncertainty(0, -140, 1000, 1_764_300_000_000);
		expect(offshore.countryUncertain).toBe(true);
		expect(offshore.place.countryCode).toBeNull();
	});
});
