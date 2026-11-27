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

import type {
	SubscriptionCreateRequest,
	SubscriptionResponse,
	SubscriptionServiceStatus,
} from '../../shared/contracts';
import { getAuthorityById } from '../../shared/warningRegistry';
import { validateCoordinates } from './firms';
import { checkD1SchemaReady } from './history';
import {
	evaluateAuthorityRecordsForPoint,
	refreshOrLoadAuthoritySnapshot,
	type AuthoritySnapshotDoc,
	type FetchLike,
} from './warnings/adapters';

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
): Promise<SubscriptionServiceStatus> {
	const d1State = await checkD1SchemaReady(db);
	if (d1State === 'unbound') {
		return {
			available: false,
			mode: 'unavailable',
			smsAvailable: false,
			reason: 'Subscription database (AEGIS_DB) is not bound in this environment.',
		};
	}
	if (d1State === 'schema_missing') {
		return {
			available: false,
			mode: 'unavailable',
			smsAvailable: false,
			reason: 'Subscription database schema migrations have not been applied.',
		};
	}
	if (transport.mode === 'disabled') {
		return {
			available: false,
			mode: 'unavailable',
			smsAvailable: false,
			reason:
				'Automated email alert delivery is not configured in this deployment (RESEND_API_KEY missing). Official warnings remain available directly in Near me.',
		};
	}
	return {
		available: true,
		mode: transport.mode,
		smsAvailable: false,
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
					'Regional SMS alerts are deferred until carrier coverage, cost limits, and verified delivery callbacks are enabled. Use opt-in email alerts or calendar reminders.',
			},
		};
	}

	if (req.channel !== 'email' || typeof req.destination !== 'string' || !EMAIL_RE.test(req.destination.trim())) {
		return { status: 400, body: { ok: false, code: 'invalid_email', message: 'Valid email address required.' } };
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

	const nowIso = (options.now ?? new Date()).toISOString();
	const id = crypto.randomUUID();
	const confirmToken = crypto.randomUUID();
	const unsubscribeToken = crypto.randomUUID();
	const destination = req.destination.trim().toLowerCase();
	const placeName = (req.placeName || 'Monitored Location').trim().slice(0, 120);
	const countryCode = (req.countryCode || authority.countryCodes[0]).trim().toUpperCase().slice(0, 2);
	const minSeverity = req.minSeverity === 'extreme' || req.minSeverity === 'severe' ? req.minSeverity : 'moderate';
	const roundedLat = Number(req.lat.toFixed(3));
	const roundedLng = Number(req.lng.toFixed(3));

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

export async function unsubscribeSubscription(
	db: D1Database | undefined,
	token: string,
	now: Date = new Date(),
): Promise<{ status: number; body: SubscriptionResponse }> {
	if (!db) {
		return { status: 503, body: { ok: false, code: 'db_unavailable', message: 'D1 not configured.' } };
	}
	const clean = token.trim();
	if (!clean) {
		return { status: 400, body: { ok: false, code: 'invalid_token', message: 'Unsubscribe token required.' } };
	}

	const revokedConfirmToken = `revoked:${crypto.randomUUID()}`;
	const res = await db
		.prepare(
			`UPDATE subscriptions
			 SET status = 'unsubscribed', unsubscribed_at = ?, confirm_token = ?
			 WHERE unsubscribe_token = ? AND unsubscribe_token != ''`,
		)
		.bind(now.toISOString(), revokedConfirmToken, clean)
		.run();

	if ((res.meta?.changes ?? 0) === 0) {
		return { status: 404, body: { ok: false, code: 'not_found', message: 'Subscription unsubscribe token not found.' } };
	}

	return {
		status: 200,
		body: {
			ok: true,
			status: 'unsubscribed',
			message: 'Unsubscribed. No further warning emails will be sent for this subscription.',
		},
	};
}

interface SubRow {
	id: string;
	destination: string;
	place_name: string;
	lat: number;
	lng: number;
	country_code: string;
	source_id: string;
	min_severity: string;
	unsubscribe_token: string;
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

async function sendIdempotentDelivery(options: {
	db: D1Database;
	kv?: KVNamespace;
	transport: EmailTransport;
	deliveryId: string;
	subscriptionId: string;
	alertId: string;
	alertRevisionSentAt: string;
	msgType: string;
	idempotencyKey: string;
	to: string;
	subject: string;
	text: string;
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
	if (existing && existing.attempts >= MAX_DELIVERY_ATTEMPTS) {
		return 'max_attempts';
	}

	try {
		options.onSubrequest?.();
		const result = await options.transport.send({
			to: options.to,
			subject: options.subject,
			text: options.text,
			idempotencyKey: options.idempotencyKey,
		});
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
		const msg = err instanceof Error ? err.message : 'Delivery error';
		await options.db
			.prepare(
				`UPDATE subscription_deliveries
				 SET status = CASE WHEN attempts + 1 >= ? THEN 'failed_permanent' ELSE 'retry_pending' END,
				     attempts = attempts + 1,
				     last_error = ?,
				     updated_at = ?
				 WHERE id = ?`,
			)
			.bind(MAX_DELIVERY_ATTEMPTS, msg, options.nowIso, options.deliveryId)
			.run();
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
	fetchImpl?: FetchLike;
	now?: Date;
	pageSize?: number;
	maxSubscriptions?: number;
	maxSubrequests?: number;
}): Promise<DispatchSummary> {
	if (!options.db || options.transport.mode === 'disabled') {
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

	try {
		// 1. Priority retry pass for prior transient delivery failures + KV post-accept ack healing
		const retryRes = await options.db
			.prepare(
				`SELECT d.id, d.subscription_id, d.alert_id, d.alert_revision_sent_at, d.msg_type,
				        d.idempotency_key, d.rendered_subject, d.rendered_body,
				        s.destination
				 FROM subscription_deliveries d
				 JOIN subscriptions s ON s.id = d.subscription_id
				 WHERE d.status IN ('retry_pending', 'pending_send') AND d.attempts < ? AND s.status = 'active'
				 ORDER BY d.updated_at ASC, d.id ASC
				 LIMIT 20`,
			)
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
				destination: string;
			}>();

		for (const r of retryRes.results ?? []) {
			if (subrequestCount >= maxSubrequests) break;
			processed++;
			const outcome = await sendIdempotentDelivery({
				db: options.db,
				kv: options.kv,
				transport: options.transport,
				deliveryId: r.id,
				subscriptionId: r.subscription_id,
				alertId: r.alert_id,
				alertRevisionSentAt: r.alert_revision_sent_at,
				msgType: r.msg_type,
				idempotencyKey: r.idempotency_key,
				to: r.destination,
				subject: r.rendered_subject ?? `[AegisMap Alert] ${r.alert_id}`,
				text: r.rendered_body ?? `Official warning alert ${r.alert_id}`,
				nowIso,
				onSubrequest: () => {
					subrequestCount++;
				},
			});
			if (outcome === 'sent') sent++;
			else if (outcome === 'deduplicated') deduplicated++;
			else if (outcome === 'failed') failed++;
		}

		// 2. Resumable keyset sweep across active email subscribers
		const cursorRow = await options.db
			.prepare(
				`SELECT cursor FROM ingestion_checkpoints WHERE source = 'subscription_dispatch' AND window_key = 'active_email_cursor'`,
			)
			.first<{ cursor: string | null }>();
		cursorStart = cursorRow?.cursor ?? '';
		nextCursor = cursorStart;

		const snapCache = new Map<
			string,
			{ doc: AuthoritySnapshotDoc; status: 'ok' | 'partial' | 'stale' | 'unavailable' | 'not_modified' }
		>();

		let reachedEof = false;
		let hitSubrequestBudget = false;

		while (subscriptionsVisited < maxSubscriptions && !hitSubrequestBudget) {
			const remaining = maxSubscriptions - subscriptionsVisited;
			const take = Math.min(pageSize, remaining);
			const subPage = await options.db
				.prepare(
					`SELECT id, destination, place_name, lat, lng, country_code, source_id, min_severity, unsubscribe_token
					 FROM subscriptions
					 WHERE status = 'active' AND channel = 'email' AND id > ?
					 ORDER BY id ASC
					 LIMIT ?`,
				)
				.bind(nextCursor, take)
				.all<SubRow>();

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
							const block = matched.translations[0];
							const labelKind = isSupersedingUpdate ? 'Official Update' : 'Official Alert';
							const subject = `[AegisMap ${labelKind} · ${matched.severity.toUpperCase()}] ${block?.headline ?? matched.category} (${sub.place_name})`;
							const text = [
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

							const outcome = await sendIdempotentDelivery({
								db: options.db,
								kv: options.kv,
								transport: options.transport,
								deliveryId,
								subscriptionId: sub.id,
								alertId: matched.identifier,
								alertRevisionSentAt: matched.sentAt,
								msgType: isSupersedingUpdate ? 'Update' : matched.msgType,
								idempotencyKey,
								to: sub.destination,
								subject,
								text,
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
							const cancelText = [
								`Issuer: ${spec.authorityName}`,
								`Cancelled Warning ID: ${matchingPriorIds.join(', ')}`,
								`Cancellation Notice ID: ${cancelRec.identifier}`,
								`Cancellation Sent (UTC): ${cancelRec.sentAt}`,
								`Monitored Area: ${sub.place_name}`,
								cancelRec.translations[0]?.headline ? `Headline: ${cancelRec.translations[0].headline}` : '',
								`\nUnsubscribe token: ${sub.unsubscribe_token}`,
							]
								.filter(Boolean)
								.join('\n');

							const outcome = await sendIdempotentDelivery({
								db: options.db,
								kv: options.kv,
								transport: options.transport,
								deliveryId: cancelDeliveryId,
								subscriptionId: sub.id,
								alertId: primaryPrevId,
								alertRevisionSentAt: 'cancelled',
								msgType: 'Cancel',
								idempotencyKey: cancelKey,
								to: sub.destination,
								subject: cancelSubject,
								text: cancelText,
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
				nextCursor = sub.id;
				subscriptionsVisited++;
			}

			if (rows.length < take && !hitSubrequestBudget) {
				reachedEof = true;
				break;
			}
		}

		const persistedCursor = reachedEof ? '' : nextCursor;
		await options.db
			.prepare(
				`INSERT INTO ingestion_checkpoints (source, window_key, cursor, updated_at, status, records_processed)
				 VALUES ('subscription_dispatch', 'active_email_cursor', ?, ?, 'ok', ?)
				 ON CONFLICT(source, window_key) DO UPDATE SET
					cursor = excluded.cursor,
					updated_at = excluded.updated_at,
					status = 'ok',
					records_processed = excluded.records_processed`,
			)
			.bind(persistedCursor, nowIso, subscriptionsVisited)
			.run();

		return {
			processed,
			sent,
			deduplicated,
			failed,
			cursorStart,
			cursorEnd: persistedCursor,
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
