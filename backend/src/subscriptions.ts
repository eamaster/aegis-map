/**
 * Opt-in Verified Warning Subscriptions & Durable Idempotent Outbox Dispatcher.
 *
 * - Delivery modes:
 *   - `resend`: live email delivery via Resend API with `Idempotency-Key` (no preview tokens leaked).
 *   - `sandbox`: enabled ONLY when `ALLOW_SANDBOX_EMAIL=true` (tests / isolated preview).
 *   - `disabled`: missing mail config in production -> honest 503 `delivery_unavailable`, no false promise.
 * - Regional SMS channel: explicitly deferred (`501 sms_deferred`).
 * - Consent & Unsubscribe: single-use confirmation token (`consumed:*` on confirm, `revoked:*` on unsubscribe);
 *   unsubscribed rows reject confirmation token replay with `409 subscription_unsubscribed`.
 * - False-clearance protection: cancellations are sent ONLY for explicit issuer `Cancel` messages, never
 *   from partial feeds, skipped items, exhausted fetch budgets, malformed siblings, unresolved geometry,
 *   natural expiry, missing items, or severity filter changes.
 * - Bounded & Resumable Dispatch: distributed D1 lease in `ingestion_checkpoints`, priority `retry_pending`
 *   pass with KV receipt healing, keyset cursor pagination over active subscribers (`LIMIT pageSize`), and
 *   paginated prior-delivery lookup (no truncation at 50).
 */

import {
	buildPushPlaceKey,
	canonicalizeSubscriptionCoordinates,
	type PushLookupResponse,
	type PushRegistrationSummary,
	type SubscriptionCreateRequest,
	type SubscriptionResponse,
	type SubscriptionServiceStatus,
	type WebPushNotificationPayload,
	type WebPushNotificationRoute,
} from '../../shared/contracts';
import { getAuthorityById } from '../../shared/warningRegistry';
import { validateCoordinates } from './firms';
import { checkD1SchemaReady, checkWebPushSchemaReady } from './history';
import {
	evaluateAuthorityRecordsForPoint,
	refreshOrLoadAuthoritySnapshot,
	type AuthoritySnapshotDoc,
	type FetchLike,
} from './warnings/adapters';
import {
	buildPushTopic,
	PushEndpointGoneError,
	validatePushEndpoint,
	validatePushKeyMaterial,
	type WebPushTransport,
} from './webPush';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_DELIVERY_ATTEMPTS = 3;
const DISPATCH_LEASE_MS = 55_000;

export interface EmailSendRequest {
	to: string;
	subject: string;
	text: string;
	idempotencyKey: string;
}

export interface EmailTransport {
	mode: 'sandbox' | 'resend' | 'disabled';
	send(msg: EmailSendRequest): Promise<{ providerMessageId: string }>;
}

export function createEmailTransport(options: {
	resendApiKey?: string;
	fromAddress?: string;
	allowSandbox?: boolean;
	fetchImpl?: FetchLike;
}): EmailTransport {
	const apiKey = options.resendApiKey?.trim();
	if (!apiKey) {
		if (options.allowSandbox) {
			return {
				mode: 'sandbox',
				async send(msg) {
					return { providerMessageId: `sandbox:${msg.idempotencyKey}` };
				},
			};
		}
		return {
			mode: 'disabled',
			async send() {
				throw new Error('Email delivery transport is disabled (RESEND_API_KEY not configured)');
			},
		};
	}

	const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const from = options.fromAddress?.trim() || 'AegisMap Alerts <alerts@hesam.me>';
	return {
		mode: 'resend',
		async send(msg) {
			const res = await fetchImpl('https://api.resend.com/emails', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'Idempotency-Key': msg.idempotencyKey,
				},
				body: JSON.stringify({
					from,
					to: [msg.to],
					subject: msg.subject,
					text: msg.text,
				}),
				signal: AbortSignal.timeout(8_000),
			});
			if (!res.ok) {
				throw new Error(`Email provider HTTP ${res.status}`);
			}
			const json = (await res.json()) as { id?: string };
			return { providerMessageId: json.id ?? msg.idempotencyKey };
		},
	};
}

export async function getSubscriptionServiceStatus(
	db: D1Database | undefined,
	transport: EmailTransport,
	pushTransport?: WebPushTransport,
): Promise<SubscriptionServiceStatus> {
	const d1State = await checkD1SchemaReady(db);
	const pushSchemaState = await checkWebPushSchemaReady(db);

	let pushAvailable = false;
	let pushMode: SubscriptionServiceStatus['pushMode'] = 'unavailable';
	let vapidPublicKey: string | undefined;
	let pushReason: string | undefined;

	if (d1State !== 'ready') {
		pushReason = 'Subscription database is not ready in this environment.';
	} else if (pushSchemaState !== 'ready') {
		pushReason = 'Push subscription schema migration (0003) has not been applied.';
	} else if (!pushTransport || pushTransport.mode === 'disabled') {
		pushReason =
			'Browser push notifications are not configured in this deployment (VAPID keys missing). Official warnings remain available directly in Near me.';
	} else {
		vapidPublicKey = await pushTransport.getVapidPublicKey();
		if (vapidPublicKey) {
			pushAvailable = true;
			pushMode = pushTransport.mode;
		} else {
			pushReason = 'Browser push notifications are not configured (invalid VAPID public key).';
		}
	}

	if (d1State === 'unbound') {
		return {
			available: false,
			mode: 'unavailable',
			smsAvailable: false,
			reason: 'Subscription database (AEGIS_DB) is not bound in this environment.',
			pushAvailable,
			pushMode,
			...(vapidPublicKey ? { vapidPublicKey } : {}),
			...(pushReason ? { pushReason } : {}),
		};
	}
	if (d1State === 'schema_missing') {
		return {
			available: false,
			mode: 'unavailable',
			smsAvailable: false,
			reason: 'Subscription database schema migrations have not been applied.',
			pushAvailable,
			pushMode,
			...(vapidPublicKey ? { vapidPublicKey } : {}),
			...(pushReason ? { pushReason } : {}),
		};
	}
	if (transport.mode === 'disabled') {
		return {
			available: false,
			mode: 'unavailable',
			smsAvailable: false,
			reason:
				'Automated email alert delivery is not configured in this deployment (RESEND_API_KEY missing). Official warnings remain available directly in Near me.',
			pushAvailable,
			pushMode,
			...(vapidPublicKey ? { vapidPublicKey } : {}),
			...(pushReason ? { pushReason } : {}),
		};
	}
	return {
		available: true,
		mode: transport.mode,
		smsAvailable: false,
		pushAvailable,
		pushMode,
		...(vapidPublicKey ? { vapidPublicKey } : {}),
		...(pushReason ? { pushReason } : {}),
	};
}

function severityRank(sev: string): number {
	if (sev === 'extreme') return 4;
	if (sev === 'severe') return 3;
	if (sev === 'moderate') return 2;
	if (sev === 'minor') return 1;
	return 0;
}

export async function createSubscription(options: {
	db: D1Database | undefined;
	req: SubscriptionCreateRequest;
	transport?: EmailTransport;
	pushTransport?: WebPushTransport;
	allowLocalPushEndpoints?: boolean;
	now?: Date;
}): Promise<{ status: number; body: SubscriptionResponse }> {
	const { req } = options;
	if (req.channel === 'sms') {
		return {
			status: 501,
			body: {
				ok: false,
				code: 'sms_deferred',
				message:
					'Regional SMS alerts are deferred until carrier coverage, cost limits, and verified delivery callbacks are enabled. Use opt-in email alerts, browser push, or calendar reminders.',
			},
		};
	}

	const coordCheck = validateCoordinates(req.lat, req.lng);
	if (!coordCheck.valid) {
		return {
			status: 400,
			body: { ok: false, code: 'invalid_coordinates', message: coordCheck.reason ?? 'Invalid coordinates' },
		};
	}

	const authority = getAuthorityById(req.sourceId);
	if (!authority) {
		return {
			status: 400,
			body: {
				ok: false,
				code: 'unsupported_source',
				message: 'Selected warning authority is not verified or supported.',
			},
		};
	}

	if (!options.db) {
		return {
			status: 503,
			body: {
				ok: false,
				code: 'db_unavailable',
				message: 'Subscription storage (D1) is not configured in this environment.',
			},
		};
	}

	const nowIso = (options.now ?? new Date()).toISOString();
	const id = crypto.randomUUID();
	const unsubscribeToken = crypto.randomUUID();
	const placeName = (req.placeName || 'Monitored Location').trim().slice(0, 120);
	const countryCode = (req.countryCode || authority.countryCodes[0]).trim().toUpperCase().slice(0, 2);
	const minSeverity = req.minSeverity === 'extreme' || req.minSeverity === 'severe' ? req.minSeverity : 'moderate';
	const { lat: roundedLat, lng: roundedLng } = canonicalizeSubscriptionCoordinates(req.lat, req.lng);

	if (req.channel === 'web_push') {
		const pushMode = options.pushTransport?.mode ?? 'disabled';
		const pushSchema = await checkWebPushSchemaReady(options.db);
		if (pushMode === 'disabled' || pushSchema !== 'ready') {
			return {
				status: 503,
				body: {
					ok: false,
					code: 'push_delivery_unavailable',
					transportMode: 'disabled',
					message:
						'Browser push notification delivery is not configured on this server. Official warnings remain available directly in Near me.',
				},
			};
		}

		const pushSub = req.pushSubscription;
		if (!pushSub || typeof pushSub.endpoint !== 'string' || !pushSub.keys) {
			return {
				status: 400,
				body: { ok: false, code: 'invalid_push_subscription', message: 'Valid Web Push subscription object required.' },
			};
		}
		const endpointCheck = validatePushEndpoint(pushSub.endpoint, {
			allowLocalTest: options.allowLocalPushEndpoints || pushMode === 'sandbox',
		});
		if (!endpointCheck.ok) {
			return {
				status: 400,
				body: { ok: false, code: 'invalid_push_endpoint', message: endpointCheck.reason },
			};
		}
		const keyCheck = validatePushKeyMaterial(pushSub.keys.p256dh, pushSub.keys.auth);
		if (!keyCheck.ok) {
			return {
				status: 400,
				body: { ok: false, code: 'invalid_push_keys', message: keyCheck.reason },
			};
		}

		const destination = endpointCheck.url.href;
		const consumedToken = `consumed:${crypto.randomUUID()}`;
		const expirationTime =
			typeof pushSub.expirationTime === 'number' && Number.isFinite(pushSub.expirationTime)
				? Math.round(pushSub.expirationTime)
				: null;
		const userLocale = typeof req.locale === 'string' && req.locale.trim() ? req.locale.trim().slice(0, 16) : null;

		// Single atomic D1 batch transaction: upsert subscription (retaining stable id & active token on conflict),
		// upsert push encryption keys by canonical lookup, and read back the committed row.
		// If key persistence fails for any reason, D1 rolls back the entire batch.
		const upsertSubStmt = options.db
			.prepare(
				`INSERT INTO subscriptions (
					id, channel, destination, place_name, lat, lng, country_code, source_id,
					min_severity, status, confirm_token, unsubscribe_token, created_at, confirmed_at
				) VALUES (?, 'web_push', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
				ON CONFLICT(channel, destination, source_id, lat, lng) DO UPDATE SET
					place_name = excluded.place_name,
					country_code = excluded.country_code,
					min_severity = excluded.min_severity,
					status = 'active',
					confirm_token = excluded.confirm_token,
					unsubscribe_token = CASE
						WHEN subscriptions.status = 'unsubscribed' THEN excluded.unsubscribe_token
						ELSE subscriptions.unsubscribe_token
					END,
					confirmed_at = COALESCE(subscriptions.confirmed_at, excluded.confirmed_at),
					unsubscribed_at = NULL`,
			)
			.bind(
				id,
				destination,
				placeName,
				roundedLat,
				roundedLng,
				countryCode,
				authority.sourceId,
				minSeverity,
				consumedToken,
				unsubscribeToken,
				nowIso,
				nowIso,
			);

		const upsertKeysStmt = options.db
			.prepare(
				`INSERT INTO push_subscription_keys (subscription_id, p256dh, auth, expiration_time, user_locale, updated_at)
				 SELECT id, ?, ?, ?, ?, ?
				 FROM subscriptions
				 WHERE channel = 'web_push' AND destination = ? AND source_id = ? AND lat = ? AND lng = ?
				 ON CONFLICT(subscription_id) DO UPDATE SET
					p256dh = excluded.p256dh,
					auth = excluded.auth,
					expiration_time = excluded.expiration_time,
					user_locale = excluded.user_locale,
					updated_at = excluded.updated_at`,
			)
			.bind(
				pushSub.keys.p256dh.trim(),
				pushSub.keys.auth.trim(),
				expirationTime,
				userLocale,
				nowIso,
				destination,
				authority.sourceId,
				roundedLat,
				roundedLng,
			);

		const selectSubStmt = options.db
			.prepare(
				`SELECT id, status, unsubscribe_token FROM subscriptions
				 WHERE channel = 'web_push' AND destination = ? AND source_id = ? AND lat = ? AND lng = ?`,
			)
			.bind(destination, authority.sourceId, roundedLat, roundedLng);

		const batchResults = await options.db.batch([upsertSubStmt, upsertKeysStmt, selectSubStmt]);
		const row = (
			batchResults[2]?.results?.[0] as
				| {
						id: string;
						status: 'pending_confirmation' | 'active' | 'unsubscribed';
						unsubscribe_token: string;
				  }
				| undefined
		);

		const subscriptionId = row?.id ?? id;
		const tokenForUnsub = row?.unsubscribe_token ?? unsubscribeToken;

		return {
			status: 201,
			body: {
				ok: true,
				subscriptionId,
				status: row?.status ?? 'active',
				transportMode: pushMode,
				unsubscribeToken: tokenForUnsub,
				message: 'Browser push warning alerts activated for this location.',
			},
		};
	}

	if (req.channel !== 'email' || typeof req.destination !== 'string' || !EMAIL_RE.test(req.destination.trim())) {
		return { status: 400, body: { ok: false, code: 'invalid_email', message: 'Valid email address required.' } };
	}

	const transportMode = options.transport?.mode ?? 'disabled';
	if (transportMode === 'disabled') {
		return {
			status: 503,
			body: {
				ok: false,
				code: 'delivery_unavailable',
				transportMode: 'disabled',
				message:
					'Email alert delivery is unavailable because no mail delivery provider is configured on this server. Check Near me directly for live warnings or export .ics pass snapshots.',
			},
		};
	}

	const confirmToken = crypto.randomUUID();
	const destination = req.destination.trim().toLowerCase();

	// Always require fresh opt-in confirmation & rotate both tokens on conflict/resubscribe
	await options.db
		.prepare(
			`INSERT INTO subscriptions (
				id, channel, destination, place_name, lat, lng, country_code, source_id,
				min_severity, status, confirm_token, unsubscribe_token, created_at
			) VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?, 'pending_confirmation', ?, ?, ?)
			ON CONFLICT(channel, destination, source_id, lat, lng) DO UPDATE SET
				place_name = excluded.place_name,
				min_severity = excluded.min_severity,
				status = 'pending_confirmation',
				confirm_token = excluded.confirm_token,
				unsubscribe_token = excluded.unsubscribe_token,
				confirmed_at = NULL,
				unsubscribed_at = NULL`,
		)
		.bind(
			id,
			destination,
			placeName,
			roundedLat,
			roundedLng,
			countryCode,
			authority.sourceId,
			minSeverity,
			confirmToken,
			unsubscribeToken,
			nowIso,
		)
		.run();

	const row = await options.db
		.prepare(
			`SELECT id, status, confirm_token, unsubscribe_token FROM subscriptions
			 WHERE channel = 'email' AND destination = ? AND source_id = ? AND lat = ? AND lng = ?`,
		)
		.bind(destination, authority.sourceId, roundedLat, roundedLng)
		.first<{
			id: string;
			status: 'pending_confirmation' | 'active' | 'unsubscribed';
			confirm_token: string;
			unsubscribe_token: string;
		}>();

	const subscriptionId = row?.id ?? id;
	const tokenForConfirm = row?.confirm_token ?? confirmToken;
	const tokenForUnsub = row?.unsubscribe_token ?? unsubscribeToken;

	if (transportMode === 'resend' && options.transport) {
		try {
			await options.transport.send({
				to: destination,
				subject: `[AegisMap] Confirm official warning alerts for ${placeName}`,
				text: [
					`You requested official warning alerts for ${placeName} (${authority.authorityName}).`,
					`Minimum severity: ${minSeverity}`,
					`Confirmation token: ${tokenForConfirm}`,
					`If you did not request this, ignore this message.`,
				].join('\n'),
				idempotencyKey: `aegis-confirm-${subscriptionId}-${tokenForConfirm}`,
			});
		} catch {
			return {
				status: 502,
				body: {
					ok: false,
					code: 'delivery_provider_error',
					transportMode: 'resend',
					message: 'Failed to send confirmation email through delivery provider. Please try again later.',
				},
			};
		}
		return {
			status: 201,
			body: {
				ok: true,
				subscriptionId,
				status: row?.status ?? 'pending_confirmation',
				transportMode: 'resend',
				message: 'Confirmation email sent. Enter your verification token to activate warning alerts.',
			},
		};
	}

	return {
		status: 201,
		body: {
			ok: true,
			subscriptionId,
			status: row?.status ?? 'pending_confirmation',
			transportMode: 'sandbox',
			sandboxPreviewToken: tokenForConfirm,
			sandboxUnsubscribeToken: tokenForUnsub,
			message:
				'Subscription created in pending confirmation state (isolated sandbox transport — no real external email sent).',
		},
	};
}

export async function confirmSubscription(
	db: D1Database | undefined,
	token: string,
	now: Date = new Date(),
): Promise<{ status: number; body: SubscriptionResponse }> {
	if (!db) {
		return { status: 503, body: { ok: false, code: 'db_unavailable', message: 'D1 not configured.' } };
	}
	const clean = token.trim();
	if (!clean || clean.startsWith('consumed:') || clean.startsWith('revoked:')) {
		return { status: 400, body: { ok: false, code: 'invalid_token', message: 'Valid confirmation token required.' } };
	}

	const existing = await db
		.prepare(`SELECT id, status FROM subscriptions WHERE confirm_token = ?`)
		.bind(clean)
		.first<{ id: string; status: 'pending_confirmation' | 'active' | 'unsubscribed' }>();

	if (!existing) {
		return { status: 404, body: { ok: false, code: 'not_found', message: 'Subscription confirmation token not found.' } };
	}

	if (existing.status === 'unsubscribed') {
		return {
			status: 409,
			body: {
				ok: false,
				subscriptionId: existing.id,
				status: 'unsubscribed',
				code: 'subscription_unsubscribed',
				message:
					'This subscription has already been unsubscribed and cannot be reactivated with an old confirmation token. Submit a new request to opt in again.',
			},
		};
	}

	const consumedToken = `consumed:${crypto.randomUUID()}`;
	const res = await db
		.prepare(
			`UPDATE subscriptions
			 SET status = 'active', confirmed_at = COALESCE(confirmed_at, ?), confirm_token = ?
			 WHERE id = ? AND confirm_token = ? AND status IN ('pending_confirmation', 'active')`,
		)
		.bind(now.toISOString(), consumedToken, existing.id, clean)
		.run();

	if ((res.meta?.changes ?? 0) === 0) {
		return {
			status: 409,
			body: {
				ok: false,
				code: 'token_already_used',
				message: 'Confirmation token is no longer valid.',
			},
		};
	}

	return {
		status: 200,
		body: {
			ok: true,
			subscriptionId: existing.id,
			status: 'active',
			message: 'Subscription confirmed. Verified official warnings matching your area will be delivered.',
		},
	};
}

export async function lookupPushRegistrations(
	db: D1Database | undefined,
	endpoint: string,
	options: { allowLocalPushEndpoints?: boolean } = {},
): Promise<{ status: number; body: PushLookupResponse }> {
	if (!db) {
		return {
			status: 503,
			body: { ok: false, registrations: [], code: 'db_unavailable', message: 'D1 not configured.' },
		};
	}
	const pushSchema = await checkWebPushSchemaReady(db);
	if (pushSchema !== 'ready') {
		return {
			status: 200,
			body: { ok: true, registrations: [] },
		};
	}
	const check = validatePushEndpoint(endpoint, { allowLocalTest: options.allowLocalPushEndpoints });
	if (!check.ok) {
		return {
			status: 400,
			body: { ok: false, registrations: [], code: 'invalid_push_endpoint', message: check.reason },
		};
	}

	const rows = await db
		.prepare(
			`SELECT s.id, s.place_name, s.country_code, s.source_id, s.lat, s.lng, s.min_severity
			 FROM subscriptions s
			 JOIN push_subscription_keys pk ON pk.subscription_id = s.id
			 WHERE s.channel = 'web_push' AND s.destination = ? AND s.status = 'active'
			 ORDER BY s.created_at ASC`,
		)
		.bind(check.url.href)
		.all<{
			id: string;
			place_name: string;
			country_code: string;
			source_id: string;
			lat: number;
			lng: number;
			min_severity: string;
		}>();

	const registrations: PushRegistrationSummary[] = (rows.results ?? []).map((r) => ({
		subscriptionId: r.id,
		placeKey: buildPushPlaceKey(r.source_id, r.lat, r.lng),
		placeName: r.place_name,
		countryCode: r.country_code,
		sourceId: r.source_id,
		lat: r.lat,
		lng: r.lng,
		minSeverity: r.min_severity === 'extreme' || r.min_severity === 'severe' ? r.min_severity : 'moderate',
		status: 'active',
	}));

	return {
		status: 200,
		body: { ok: true, registrations },
	};
}

export async function unsubscribeSubscription(
	db: D1Database | undefined,
	token: string,
	now: Date = new Date(),
	options: {
		endpoint?: string;
		channel?: 'email' | 'web_push';
		scope?: 'place' | 'device';
		subscriptionId?: string;
		sourceId?: string;
		lat?: number;
		lng?: number;
		allowLocalPushEndpoints?: boolean;
	} = {},
): Promise<{ status: number; body: SubscriptionResponse }> {
	if (!db) {
		return { status: 503, body: { ok: false, code: 'db_unavailable', message: 'D1 not configured.' } };
	}
	const clean = token.trim();
	const cleanEndpointRaw = options.endpoint?.trim() ?? '';
	if (!clean && !cleanEndpointRaw) {
		return { status: 400, body: { ok: false, code: 'invalid_token', message: 'Unsubscribe token or push endpoint required.' } };
	}

	const revokedConfirmToken = `revoked:${crypto.randomUUID()}`;
	const nowIso = now.toISOString();
	const hasPushKeysTable = (await checkWebPushSchemaReady(db)) === 'ready';

	if (clean) {
		const stmts: D1PreparedStatement[] = [];
		if (hasPushKeysTable) {
			stmts.push(
				db
					.prepare(
						`DELETE FROM push_subscription_keys
						 WHERE subscription_id IN (
							SELECT id FROM subscriptions WHERE unsubscribe_token = ? AND unsubscribe_token != ''
						 )`,
					)
					.bind(clean),
			);
		}
		stmts.push(
			db
				.prepare(
					`UPDATE subscriptions
					 SET status = 'unsubscribed', unsubscribed_at = ?, confirm_token = ?
					 WHERE unsubscribe_token = ? AND unsubscribe_token != ''`,
				)
				.bind(nowIso, revokedConfirmToken, clean),
		);
		const batchRes = await db.batch(stmts);
		const updateRes = batchRes[batchRes.length - 1];
		const changes = updateRes?.meta?.changes ?? 0;

		if (changes === 0) {
			return { status: 404, body: { ok: false, code: 'not_found', message: 'Subscription unsubscribe token not found.' } };
		}

		return {
			status: 200,
			body: {
				ok: true,
				status: 'unsubscribed',
				scope: 'token',
				removedCount: changes,
				message: 'Unsubscribed. No further warning alerts will be sent for this subscription.',
			},
		};
	}

	const endpointCheck = validatePushEndpoint(cleanEndpointRaw, { allowLocalTest: options.allowLocalPushEndpoints });
	const cleanEndpoint = endpointCheck.ok ? endpointCheck.url.href : cleanEndpointRaw;
	const isPlaceScope =
		options.scope === 'place' ||
		Boolean(options.subscriptionId?.trim()) ||
		(Boolean(options.sourceId?.trim()) && typeof options.lat === 'number' && typeof options.lng === 'number');

	if (isPlaceScope) {
		const subId = options.subscriptionId?.trim();
		const srcId = options.sourceId?.trim();
		const hasCoords =
			typeof options.lat === 'number' &&
			typeof options.lng === 'number' &&
			Number.isFinite(options.lat) &&
			Number.isFinite(options.lng);

		if (!subId && (!srcId || !hasCoords)) {
			return {
				status: 400,
				body: {
					ok: false,
					code: 'invalid_place_scope',
					message: 'Place-scoped push removal requires subscriptionId or (sourceId, lat, lng).',
				},
			};
		}

		const stmts: D1PreparedStatement[] = [];
		if (subId) {
			if (hasPushKeysTable) {
				stmts.push(
					db
						.prepare(
							`DELETE FROM push_subscription_keys
							 WHERE subscription_id IN (
								SELECT id FROM subscriptions
								WHERE id = ? AND channel = 'web_push' AND destination = ? AND status != 'unsubscribed'
							 )`,
						)
						.bind(subId, cleanEndpoint),
				);
			}
			stmts.push(
				db
					.prepare(
						`UPDATE subscriptions
						 SET status = 'unsubscribed', unsubscribed_at = ?, confirm_token = ?
						 WHERE id = ? AND channel = 'web_push' AND destination = ? AND status != 'unsubscribed'`,
					)
					.bind(nowIso, revokedConfirmToken, subId, cleanEndpoint),
			);
		} else {
			const { lat: rLat, lng: rLng } = canonicalizeSubscriptionCoordinates(options.lat!, options.lng!);
			if (hasPushKeysTable) {
				stmts.push(
					db
						.prepare(
							`DELETE FROM push_subscription_keys
							 WHERE subscription_id IN (
								SELECT id FROM subscriptions
								WHERE channel = 'web_push' AND destination = ? AND source_id = ? AND lat = ? AND lng = ? AND status != 'unsubscribed'
							 )`,
						)
						.bind(cleanEndpoint, srcId!, rLat, rLng),
				);
			}
			stmts.push(
				db
					.prepare(
						`UPDATE subscriptions
						 SET status = 'unsubscribed', unsubscribed_at = ?, confirm_token = ?
						 WHERE channel = 'web_push' AND destination = ? AND source_id = ? AND lat = ? AND lng = ? AND status != 'unsubscribed'`,
					)
					.bind(nowIso, revokedConfirmToken, cleanEndpoint, srcId!, rLat, rLng),
			);
		}
		stmts.push(
			db
				.prepare(
					`SELECT COUNT(*) AS cnt FROM subscriptions
					 WHERE channel = 'web_push' AND destination = ? AND status = 'active'`,
				)
				.bind(cleanEndpoint),
		);

		const batchRes = await db.batch(stmts);
		const updateRes = batchRes[batchRes.length - 2];
		const countRow = batchRes[batchRes.length - 1]?.results?.[0] as { cnt?: number } | undefined;
		const removedCount = updateRes?.meta?.changes ?? 0;
		const remainingCount = Number(countRow?.cnt ?? 0);

		if (removedCount === 0) {
			return {
				status: 404,
				body: {
					ok: false,
					code: 'not_found',
					scope: 'place',
					removedCount: 0,
					remainingCount,
					message: 'No active push subscription found for this place.',
				},
			};
		}

		return {
			status: 200,
			body: {
				ok: true,
				status: 'unsubscribed',
				scope: 'place',
				removedCount,
				remainingCount,
				message:
					remainingCount > 0
						? 'Push alerts disabled for this place. Other subscribed places on this browser remain active.'
						: 'Push alerts disabled for this place.',
			},
		};
	}

	// Device-wide push unsubscribe: revoke every active registration bound to this endpoint atomically
	const deviceStmts: D1PreparedStatement[] = [];
	if (hasPushKeysTable) {
		deviceStmts.push(
			db
				.prepare(
					`DELETE FROM push_subscription_keys
					 WHERE subscription_id IN (
						SELECT id FROM subscriptions WHERE channel = 'web_push' AND destination = ? AND status != 'unsubscribed'
					 )`,
				)
				.bind(cleanEndpoint),
		);
	}
	deviceStmts.push(
		db
			.prepare(
				`UPDATE subscriptions
				 SET status = 'unsubscribed', unsubscribed_at = ?, confirm_token = ?
				 WHERE channel = 'web_push' AND destination = ? AND status != 'unsubscribed'`,
			)
			.bind(nowIso, revokedConfirmToken, cleanEndpoint),
	);

	const deviceBatch = await db.batch(deviceStmts);
	const pushRes = deviceBatch[deviceBatch.length - 1];
	const removedCount = pushRes?.meta?.changes ?? 0;

	if (removedCount === 0) {
		return {
			status: 404,
			body: { ok: false, code: 'not_found', scope: 'device', removedCount: 0, remainingCount: 0, message: 'Push subscription not found.' },
		};
	}
	return {
		status: 200,
		body: {
			ok: true,
			status: 'unsubscribed',
			scope: 'device',
			removedCount,
			remainingCount: 0,
			message: 'Push notifications disabled across all places on this browser.',
		},
	};
}

interface SubRow {
	id: string;
	channel: 'email' | 'web_push';
	destination: string;
	place_name: string;
	lat: number;
	lng: number;
	country_code: string;
	source_id: string;
	min_severity: string;
	unsubscribe_token: string;
	p256dh: string | null;
	auth: string | null;
	user_locale: string | null;
}

interface DispatchSummary {
	processed: number;
	sent: number;
	deduplicated: number;
	failed: number;
	skippedLease?: boolean;
	cursorStart?: string;
	cursorEnd?: string;
	subscriptionsVisited?: number;
}

function selectPreferredTranslationForLocale<T extends { language: string }>(
	translations: readonly T[],
	userLocale?: string | null,
): T | undefined {
	if (!translations.length) return undefined;
	if (!userLocale) return translations[0];
	const norm = userLocale.trim().toLowerCase().replace(/_/g, '-');
	if (norm.startsWith('zh')) {
		const isSimplifiedPref = !norm.includes('hant') && !norm.includes('-tw') && !norm.includes('-hk') && !norm.includes('-mo');
		if (isSimplifiedPref) {
			const simplified = translations.find((t) => {
				const l = t.language.trim().toLowerCase().replace(/_/g, '-');
				return l === 'zh-hans' || l.startsWith('zh-hans-') || l === 'zh-cn' || l === 'zh-sg' || l === 'zh';
			});
			if (simplified) return simplified;
		}
		const anyZh = translations.find((t) => t.language.trim().toLowerCase().startsWith('zh'));
		if (anyZh) return anyZh;
	}
	const exact = translations.find((t) => t.language.trim().toLowerCase().replace(/_/g, '-') === norm);
	if (exact) return exact;
	const prefix = norm.split('-')[0];
	return translations.find((t) => t.language.trim().toLowerCase().replace(/_/g, '-').startsWith(prefix)) ?? translations[0];
}

function buildRelativeNotificationUrl(route: WebPushNotificationRoute): string {
	const params = new URLSearchParams({
		view: 'near-me',
		lat: String(route.lat),
		lng: String(route.lng),
		country: route.countryCode,
		warningId: route.warningId,
	});
	if (route.placeName) params.set('place', route.placeName);
	if (route.msgType === 'Cancel') params.set('noticeStatus', 'cancelled');
	return `./?${params.toString()}`;
}

async function sendIdempotentDelivery(options: {
	db: D1Database;
	kv?: KVNamespace;
	channel: 'email' | 'web_push';
	transport: EmailTransport;
	pushTransport?: WebPushTransport;
	deliveryId: string;
	subscriptionId: string;
	alertId: string;
	alertRevisionSentAt: string;
	msgType: string;
	idempotencyKey: string;
	to: string;
	subject: string;
	text: string;
	p256dh?: string | null;
	auth?: string | null;
	urgency?: 'very-low' | 'low' | 'normal' | 'high';
	nowIso: string;
	onSubrequest?: () => void;
}): Promise<'sent' | 'deduplicated' | 'failed' | 'max_attempts'> {
	const receiptKey = `sub:sent:${options.deliveryId}`;
	if (options.kv) {
		const kvReceipt = await options.kv.get(receiptKey).catch(() => null);
		if (kvReceipt) {
			// Heal D1 row if provider accepted in a previous run before D1 commit finished
			await options.db
				.prepare(
					`UPDATE subscription_deliveries
					 SET status = 'sent', provider_message_id = COALESCE(provider_message_id, ?), last_error = NULL, updated_at = ?
					 WHERE id = ? AND status != 'sent'`,
				)
				.bind(kvReceipt, options.nowIso, options.deliveryId)
				.run();
			return 'deduplicated';
		}
	}

	const claim = await options.db
		.prepare(
			`INSERT OR IGNORE INTO subscription_deliveries (
				id, subscription_id, alert_id, alert_revision_sent_at, msg_type,
				status, attempts, idempotency_key, rendered_subject, rendered_body, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, 'pending_send', 0, ?, ?, ?, ?, ?)`,
		)
		.bind(
			options.deliveryId,
			options.subscriptionId,
			options.alertId,
			options.alertRevisionSentAt,
			options.msgType,
			options.idempotencyKey,
			options.subject,
			options.text,
			options.nowIso,
			options.nowIso,
		)
		.run();

	const existing = await options.db
		.prepare(`SELECT status, attempts FROM subscription_deliveries WHERE id = ?`)
		.bind(options.deliveryId)
		.first<{ status: string; attempts: number }>();

	if ((claim.meta?.changes ?? 0) === 0 && existing?.status === 'sent') {
		return 'deduplicated';
	}
	if (existing && (existing.status === 'failed_permanent' || existing.attempts >= MAX_DELIVERY_ATTEMPTS)) {
		return 'max_attempts';
	}

	try {
		options.onSubrequest?.();
		let result: { providerMessageId: string };
		if (options.channel === 'web_push') {
			if (!options.pushTransport || options.pushTransport.mode === 'disabled' || !options.p256dh || !options.auth) {
				throw new Error('Web Push key material or transport unavailable');
			}
			const topic = await buildPushTopic(options.alertId, options.msgType);
			result = await options.pushTransport.send({
				endpoint: options.to,
				p256dh: options.p256dh,
				auth: options.auth,
				payloadJson: options.text,
				topic,
				urgency: options.urgency ?? 'high',
			});
		} else {
			result = await options.transport.send({
				to: options.to,
				subject: options.subject,
				text: options.text,
				idempotencyKey: options.idempotencyKey,
			});
		}
		if (options.kv) {
			await options.kv.put(receiptKey, result.providerMessageId, { expirationTtl: 7 * 86_400 }).catch(() => {});
		}
		await options.db
			.prepare(
				`UPDATE subscription_deliveries
				 SET status = 'sent', attempts = attempts + 1, provider_message_id = ?, last_error = NULL, updated_at = ?
				 WHERE id = ?`,
			)
			.bind(result.providerMessageId, options.nowIso, options.deliveryId)
			.run();
		return 'sent';
	} catch (err) {
		const isGone = err instanceof PushEndpointGoneError;
		const msg = err instanceof Error ? err.message : 'Delivery error';
		await options.db
			.prepare(
				`UPDATE subscription_deliveries
				 SET status = CASE WHEN ? = 1 OR attempts + 1 >= ? THEN 'failed_permanent' ELSE 'retry_pending' END,
				     attempts = attempts + 1,
				     last_error = ?,
				     updated_at = ?
				 WHERE id = ?`,
			)
			.bind(isGone ? 1 : 0, MAX_DELIVERY_ATTEMPTS, msg, options.nowIso, options.deliveryId)
			.run();
		if (isGone) {
			// A 404/410 from the push service means the browser endpoint itself is dead across all places on it.
			await options.db
				.batch([
					options.db
						.prepare(
							`DELETE FROM push_subscription_keys
							 WHERE subscription_id IN (
								SELECT id FROM subscriptions WHERE channel = 'web_push' AND destination = ?
							 )`,
						)
						.bind(options.to),
					options.db
						.prepare(
							`UPDATE subscriptions
							 SET status = 'unsubscribed', unsubscribed_at = ?
							 WHERE channel = 'web_push' AND destination = ? AND status != 'unsubscribed'`,
						)
						.bind(options.nowIso, options.to),
				])
				.catch(() => {});
		}
		return 'failed';
	}
}

/**
 * Load all sent alert deliveries for one subscriber via keyset pagination (never truncates at 50).
 */
async function loadAllSentDeliveriesForSub(
	db: D1Database,
	subscriptionId: string,
): Promise<{ sentAlertIds: Set<string>; cancelledAlertIds: Set<string> }> {
	const sentAlertIds = new Set<string>();
	const cancelledAlertIds = new Set<string>();
	let afterId = '';

	while (true) {
		const res = await db
			.prepare(
				`SELECT id, alert_id, msg_type
				 FROM subscription_deliveries
				 WHERE subscription_id = ? AND status = 'sent' AND id > ?
				 ORDER BY id ASC
				 LIMIT 100`,
			)
			.bind(subscriptionId, afterId)
			.all<{ id: string; alert_id: string; msg_type: string }>();

		const rows = res.results ?? [];
		for (const row of rows) {
			if (row.msg_type === 'Cancel') cancelledAlertIds.add(row.alert_id);
			else sentAlertIds.add(row.alert_id);
			afterId = row.id;
		}
		if (rows.length < 100) break;
	}

	return { sentAlertIds, cancelledAlertIds };
}

/**
 * Durable, resumable outbox dispatch for active verified subscriptions:
 * - Acquires an expiring D1 lease so overlapping cron invocations do not double-process.
 * - Retries prior `retry_pending` failures first (healing any KV-acked rows before re-sending).
 * - Advances a keyset cursor (`active_email_cursor`) across `LIMIT pageSize` batches so >200
 *   subscribers make deterministic progress without hitting Worker subrequest/CPU caps.
 * - Uses shared `evaluateAuthorityRecordsForPoint` and emits `Cancel` emails ONLY for explicit
 *   issuer CAP `Cancel` messages (zero false clearances on partial feeds/skipped items/expiry).
 */
export async function dispatchVerifiedWarningAlerts(options: {
	db: D1Database | undefined;
	kv?: KVNamespace;
	transport: EmailTransport;
	pushTransport?: WebPushTransport;
	fetchImpl?: FetchLike;
	now?: Date;
	pageSize?: number;
	maxSubscriptions?: number;
	maxSubrequests?: number;
}): Promise<DispatchSummary> {
	const emailEnabled = options.transport.mode !== 'disabled';
	const pushEnabled = Boolean(options.pushTransport && options.pushTransport.mode !== 'disabled');
	if (!options.db || (!emailEnabled && !pushEnabled)) {
		return { processed: 0, sent: 0, deduplicated: 0, failed: 0 };
	}

	const now = options.now ?? new Date();
	const nowIso = now.toISOString();
	const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 50));
	const maxSubscriptions = Math.max(1, options.maxSubscriptions ?? 100);
	const maxSubrequests = Math.max(1, options.maxSubrequests ?? 35);
	const runId = crypto.randomUUID();
	const expiredLeaseBeforeIso = new Date(now.getTime() - DISPATCH_LEASE_MS).toISOString();

	// 0. Distributed lease claim
	await options.db
		.prepare(
			`INSERT INTO ingestion_checkpoints (source, window_key, cursor, updated_at, status, records_processed)
			 VALUES ('subscription_dispatch', 'lease', ?, ?, 'running', 0)
			 ON CONFLICT(source, window_key) DO UPDATE SET
				cursor = excluded.cursor,
				updated_at = excluded.updated_at,
				status = 'running'
			 WHERE ingestion_checkpoints.status != 'running' OR ingestion_checkpoints.updated_at <= ?`,
		)
		.bind(runId, nowIso, expiredLeaseBeforeIso)
		.run();

	const leaseRow = await options.db
		.prepare(`SELECT cursor, status FROM ingestion_checkpoints WHERE source = 'subscription_dispatch' AND window_key = 'lease'`)
		.first<{ cursor: string; status: string }>();

	if (leaseRow?.cursor !== runId || leaseRow?.status !== 'running') {
		return { processed: 0, sent: 0, deduplicated: 0, failed: 0, skippedLease: true };
	}

	let processed = 0;
	let sent = 0;
	let deduplicated = 0;
	let failed = 0;
	let subrequestCount = 0;
	let subscriptionsVisited = 0;
	let cursorStart = '';
	let nextCursor = '';

	const hasPushTable = pushEnabled && (await checkWebPushSchemaReady(options.db)) === 'ready';

	try {
		// 1. Priority retry pass for prior transient delivery failures + KV post-accept ack healing
		const retryQuery = hasPushTable
			? `SELECT d.id, d.subscription_id, d.alert_id, d.alert_revision_sent_at, d.msg_type,
			          d.idempotency_key, d.rendered_subject, d.rendered_body,
			          s.channel, s.destination, pk.p256dh, pk.auth
			   FROM subscription_deliveries d
			   JOIN subscriptions s ON s.id = d.subscription_id
			   LEFT JOIN push_subscription_keys pk ON pk.subscription_id = s.id
			   WHERE d.status IN ('retry_pending', 'pending_send') AND d.attempts < ? AND s.status = 'active'
			   ORDER BY d.updated_at ASC, d.id ASC
			   LIMIT 20`
			: `SELECT d.id, d.subscription_id, d.alert_id, d.alert_revision_sent_at, d.msg_type,
			          d.idempotency_key, d.rendered_subject, d.rendered_body,
			          s.channel, s.destination, NULL AS p256dh, NULL AS auth
			   FROM subscription_deliveries d
			   JOIN subscriptions s ON s.id = d.subscription_id
			   WHERE d.status IN ('retry_pending', 'pending_send') AND d.attempts < ? AND s.status = 'active'
			     AND s.channel = 'email'
			   ORDER BY d.updated_at ASC, d.id ASC
			   LIMIT 20`;

		const retryRes = await options.db
			.prepare(retryQuery)
			.bind(MAX_DELIVERY_ATTEMPTS)
			.all<{
				id: string;
				subscription_id: string;
				alert_id: string;
				alert_revision_sent_at: string;
				msg_type: string;
				idempotency_key: string;
				rendered_subject: string | null;
				rendered_body: string | null;
				channel: 'email' | 'web_push';
				destination: string;
				p256dh: string | null;
				auth: string | null;
			}>();

		for (const r of retryRes.results ?? []) {
			if (subrequestCount >= maxSubrequests) break;
			if (r.channel === 'email' && !emailEnabled) continue;
			if (r.channel === 'web_push' && (!pushEnabled || !hasPushTable)) continue;

			processed++;
			const outcome = await sendIdempotentDelivery({
				db: options.db,
				kv: options.kv,
				channel: r.channel,
				transport: options.transport,
				pushTransport: options.pushTransport,
				deliveryId: r.id,
				subscriptionId: r.subscription_id,
				alertId: r.alert_id,
				alertRevisionSentAt: r.alert_revision_sent_at,
				msgType: r.msg_type,
				idempotencyKey: r.idempotency_key,
				to: r.destination,
				subject: r.rendered_subject ?? `[AegisMap Alert] ${r.alert_id}`,
				text: r.rendered_body ?? `Official warning alert ${r.alert_id}`,
				p256dh: r.p256dh,
				auth: r.auth,
				nowIso,
				onSubrequest: () => {
					subrequestCount++;
				},
			});
			if (outcome === 'sent') sent++;
			else if (outcome === 'deduplicated') deduplicated++;
			else if (outcome === 'failed') failed++;
		}

		// 2. Resumable keyset sweep across active email & web_push subscribers
		const enabledChannels: Array<{ channel: 'email' | 'web_push'; cursorWindow: string }> = [];
		if (emailEnabled) enabledChannels.push({ channel: 'email', cursorWindow: 'active_email_cursor' });
		if (pushEnabled && hasPushTable) enabledChannels.push({ channel: 'web_push', cursorWindow: 'active_push_cursor' });

		const snapCache = new Map<
			string,
			{ doc: AuthoritySnapshotDoc; status: 'ok' | 'partial' | 'stale' | 'unavailable' | 'not_modified' }
		>();

		for (const chanCfg of enabledChannels) {
			if (subscriptionsVisited >= maxSubscriptions || subrequestCount >= maxSubrequests) break;

			const cursorRow = await options.db
				.prepare(
					`SELECT cursor FROM ingestion_checkpoints WHERE source = 'subscription_dispatch' AND window_key = ?`,
				)
				.bind(chanCfg.cursorWindow)
				.first<{ cursor: string | null }>();
			const chanCursorStart = cursorRow?.cursor ?? '';
			if (!cursorStart && chanCfg.channel === 'email') cursorStart = chanCursorStart;
			let chanNextCursor = chanCursorStart;

			let reachedEof = false;
			let hitSubrequestBudget = false;

			while (subscriptionsVisited < maxSubscriptions && !hitSubrequestBudget) {
				const remaining = maxSubscriptions - subscriptionsVisited;
				const take = Math.min(pageSize, remaining);
				const subSql =
					chanCfg.channel === 'web_push'
						? `SELECT s.id, s.channel, s.destination, s.place_name, s.lat, s.lng, s.country_code, s.source_id, s.min_severity, s.unsubscribe_token,
						          pk.p256dh, pk.auth, pk.user_locale
						   FROM subscriptions s
						   JOIN push_subscription_keys pk ON pk.subscription_id = s.id
						   WHERE s.status = 'active' AND s.channel = 'web_push' AND s.id > ?
						   ORDER BY s.id ASC
						   LIMIT ?`
						: `SELECT id, channel, destination, place_name, lat, lng, country_code, source_id, min_severity, unsubscribe_token,
						          NULL AS p256dh, NULL AS auth, NULL AS user_locale
						   FROM subscriptions
						   WHERE status = 'active' AND channel = 'email' AND id > ?
						   ORDER BY id ASC
						   LIMIT ?`;

				const subPage = await options.db.prepare(subSql).bind(chanNextCursor, take).all<SubRow>();

				const rows = subPage.results ?? [];
				if (rows.length === 0) {
					reachedEof = true;
					break;
				}

				for (const sub of rows) {
					if (subrequestCount >= maxSubrequests) {
						hitSubrequestBudget = true;
						break;
					}

					const spec = getAuthorityById(sub.source_id);
					if (spec) {
						let snap = snapCache.get(spec.sourceId);
						if (!snap) {
							subrequestCount++;
							snap = await refreshOrLoadAuthoritySnapshot(spec, {
								kv: options.kv,
								fetchImpl: options.fetchImpl,
								now,
							});
							snapCache.set(spec.sourceId, snap);
						}

						// Never derive notifications or cancellations from unavailable/stale snapshots
						if (snap.status !== 'unavailable' && snap.status !== 'stale') {
							const evaluation = evaluateAuthorityRecordsForPoint(snap.doc, sub.lat, sub.lng, now);
							const prior = await loadAllSentDeliveriesForSub(options.db, sub.id);
							const cancelledSet = new Set(prior.cancelledAlertIds);
							const supersededByActiveUpdate = new Set<string>();

							for (const vis of evaluation.visibleWarnings) {
								for (const refId of vis.references ?? []) {
									if (prior.sentAlertIds.has(refId)) {
										supersededByActiveUpdate.add(refId);
									}
								}
							}

							// A. Active / upcoming warnings & superseding Updates
							for (const matched of evaluation.visibleWarnings) {
								if (subrequestCount >= maxSubrequests) {
									hitSubrequestBudget = true;
									break;
								}
								if (severityRank(matched.severity) < severityRank(sub.min_severity)) continue;

								const isSupersedingUpdate =
									matched.msgType === 'Update' ||
									(matched.references?.some((refId) => prior.sentAlertIds.has(refId)) ?? false);

								processed++;
								const deliveryId = `${sub.id}:${matched.identifier}:${matched.sentAt}`;
								const idempotencyKey = `aegis-alert-${deliveryId}`;
								const block = selectPreferredTranslationForLocale(matched.translations, sub.user_locale);
								const labelKind = isSupersedingUpdate ? 'Official Update' : 'Official Alert';
								const subject = `[AegisMap ${labelKind} · ${matched.severity.toUpperCase()}] ${block?.headline ?? matched.category} (${sub.place_name})`;

								let bodyContent: string;
								if (sub.channel === 'web_push') {
									const resolvedMsgType: 'Alert' | 'Update' = isSupersedingUpdate ? 'Update' : 'Alert';
									const route: WebPushNotificationRoute = {
										view: 'near-me',
										lat: sub.lat,
										lng: sub.lng,
										countryCode: sub.country_code,
										warningId: matched.identifier,
										placeName: sub.place_name,
										msgType: resolvedMsgType,
									};
									const rawSummary = (block?.instruction || block?.description || block?.areaDesc || '').replace(/\s+/g, ' ').trim();
									const pushPayload: WebPushNotificationPayload = {
										title: `${matched.severity.toUpperCase()}: ${block?.headline ?? matched.category}`.slice(0, 140),
										body: `${matched.issuerName} · ${sub.place_name}${rawSummary ? ` — ${rawSummary.slice(0, 180)}` : ''}`.slice(0, 320),
										tag: `aegis-warning-${matched.identifier}`,
										route,
										url: buildRelativeNotificationUrl(route),
										warningId: matched.identifier,
										sourceId: matched.sourceId,
										msgType: resolvedMsgType,
										severity: matched.severity,
										sentAt: matched.sentAt,
									};
									bodyContent = JSON.stringify(pushPayload);
								} else {
									bodyContent = [
										`Issuer: ${matched.issuerName}`,
										`Severity: ${matched.severity} | Status: ${matched.lifecycleState} (${isSupersedingUpdate ? 'Update' : matched.msgType})`,
										matched.references && matched.references.length > 0
											? `Supersedes alert reference(s): ${matched.references.join(', ')}`
											: '',
										`Area: ${block?.areaDesc ?? sub.place_name}`,
										`Sent (UTC): ${matched.sentAt}`,
										matched.expiresAt ? `Expires (UTC): ${matched.expiresAt}` : 'Expiry: Not stated by issuer',
										'',
										block?.description ?? '',
										block?.instruction ? `\nOfficial Instructions:\n${block.instruction}` : '',
										matched.bulletinUrl ? `\nOfficial bulletin: ${matched.bulletinUrl}` : '',
										`\nUnsubscribe token: ${sub.unsubscribe_token}`,
									]
										.filter(Boolean)
										.join('\n');
								}

								const outcome = await sendIdempotentDelivery({
									db: options.db,
									kv: options.kv,
									channel: sub.channel,
									transport: options.transport,
									pushTransport: options.pushTransport,
									deliveryId,
									subscriptionId: sub.id,
									alertId: matched.identifier,
									alertRevisionSentAt: matched.sentAt,
									msgType: isSupersedingUpdate ? 'Update' : matched.msgType,
									idempotencyKey,
									to: sub.destination,
									subject,
									text: bodyContent,
									p256dh: sub.p256dh,
									auth: sub.auth,
									urgency: matched.severity === 'extreme' || matched.severity === 'severe' ? 'high' : 'normal',
									nowIso,
									onSubrequest: () => {
										subrequestCount++;
									},
								});
								if (outcome === 'sent') sent++;
								else if (outcome === 'deduplicated') deduplicated++;
								else if (outcome === 'failed') failed++;
							}

							if (hitSubrequestBudget) break;

							// B. Explicit Issuer Cancellations ONLY (zero false clearances on partial/expired/missing/filtered)
							for (const cancelRec of evaluation.explicitCancellations) {
								if (subrequestCount >= maxSubrequests) {
									hitSubrequestBudget = true;
									break;
								}
								const matchingPriorIds: string[] = [];
								for (const prevId of prior.sentAlertIds) {
									if (supersededByActiveUpdate.has(prevId)) continue;
									if (cancelRec.identifier === prevId || (cancelRec.references ?? []).includes(prevId)) {
										matchingPriorIds.push(prevId);
									}
								}
								if (matchingPriorIds.length === 0) continue;

								// Prevent duplicate cancellations across transitive Alert -> Update -> Cancel chains
								if (
									matchingPriorIds.some((id) => cancelledSet.has(id)) ||
									cancelledSet.has(cancelRec.identifier)
								) {
									deduplicated++;
									continue;
								}

								const primaryPrevId =
									(cancelRec.references ?? []).find((id) => matchingPriorIds.includes(id)) ??
									matchingPriorIds[0];

								for (const prevId of matchingPriorIds) {
									cancelledSet.add(prevId);
								}
								cancelledSet.add(cancelRec.identifier);

								processed++;
								const cancelDeliveryId = `${sub.id}:${primaryPrevId}:cancelled`;
								const cancelKey = `aegis-cancel-${cancelDeliveryId}`;
								const cancelSubject = `[AegisMap Official Cancellation] ${spec.authorityName} (${sub.place_name})`;
								const cancelBlock = selectPreferredTranslationForLocale(cancelRec.translations, sub.user_locale);

								let cancelContent: string;
								if (sub.channel === 'web_push') {
									const route: WebPushNotificationRoute = {
										view: 'near-me',
										lat: sub.lat,
										lng: sub.lng,
										countryCode: sub.country_code,
										warningId: primaryPrevId,
										placeName: sub.place_name,
										msgType: 'Cancel',
									};
									const pushPayload: WebPushNotificationPayload = {
										title: `Official Cancellation: ${spec.authorityName} (${sub.place_name})`.slice(0, 140),
										body: `${cancelBlock?.headline ?? `Cancelled warning ${primaryPrevId}`} · Sent ${cancelRec.sentAt}`.slice(0, 320),
										tag: `aegis-cancel-${primaryPrevId}`,
										route,
										url: buildRelativeNotificationUrl(route),
										warningId: primaryPrevId,
										sourceId: spec.sourceId,
										msgType: 'Cancel',
										severity: cancelRec.severity,
										sentAt: cancelRec.sentAt,
									};
									cancelContent = JSON.stringify(pushPayload);
								} else {
									cancelContent = [
										`Issuer: ${spec.authorityName}`,
										`Cancelled Warning ID: ${matchingPriorIds.join(', ')}`,
										`Cancellation Notice ID: ${cancelRec.identifier}`,
										`Cancellation Sent (UTC): ${cancelRec.sentAt}`,
										`Monitored Area: ${sub.place_name}`,
										cancelBlock?.headline ? `Headline: ${cancelBlock.headline}` : '',
										`\nUnsubscribe token: ${sub.unsubscribe_token}`,
									]
										.filter(Boolean)
										.join('\n');
								}

								const outcome = await sendIdempotentDelivery({
									db: options.db,
									kv: options.kv,
									channel: sub.channel,
									transport: options.transport,
									pushTransport: options.pushTransport,
									deliveryId: cancelDeliveryId,
									subscriptionId: sub.id,
									alertId: primaryPrevId,
									alertRevisionSentAt: 'cancelled',
									msgType: 'Cancel',
									idempotencyKey: cancelKey,
									to: sub.destination,
									subject: cancelSubject,
									text: cancelContent,
									p256dh: sub.p256dh,
									auth: sub.auth,
									urgency: 'normal',
									nowIso,
									onSubrequest: () => {
										subrequestCount++;
									},
								});
								if (outcome === 'sent') sent++;
								else if (outcome === 'deduplicated') deduplicated++;
								else if (outcome === 'failed') failed++;
							}
						}
					}

					if (hitSubrequestBudget) break;
					chanNextCursor = sub.id;
					subscriptionsVisited++;
				}

				if (rows.length < take && !hitSubrequestBudget) {
					reachedEof = true;
					break;
				}
			}

			const persistedCursor = reachedEof ? '' : chanNextCursor;
			if (chanCfg.channel === 'email' || !nextCursor) {
				nextCursor = persistedCursor;
			}
			await options.db
				.prepare(
					`INSERT INTO ingestion_checkpoints (source, window_key, cursor, updated_at, status, records_processed)
					 VALUES ('subscription_dispatch', ?, ?, ?, 'ok', ?)
					 ON CONFLICT(source, window_key) DO UPDATE SET
						cursor = excluded.cursor,
						updated_at = excluded.updated_at,
						status = 'ok',
						records_processed = excluded.records_processed`,
				)
				.bind(chanCfg.cursorWindow, persistedCursor, nowIso, subscriptionsVisited)
				.run();
		}

		return {
			processed,
			sent,
			deduplicated,
			failed,
			cursorStart,
			cursorEnd: nextCursor,
			subscriptionsVisited,
		};
	} finally {
		await options.db
			.prepare(
				`UPDATE ingestion_checkpoints
				 SET status = 'idle', updated_at = ?
				 WHERE source = 'subscription_dispatch' AND window_key = 'lease' AND cursor = ?`,
			)
			.bind(new Date().toISOString(), runId)
			.run()
			.catch(() => {});
	}
}
