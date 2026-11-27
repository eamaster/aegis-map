/**
 * Opt-in Verified Warning Subscriptions & Durable Idempotent Outbox Dispatcher.
 *
 * - Email channel: double opt-in (pending_confirmation -> active -> unsubscribed).
 * - Regional SMS channel: explicitly deferred (501 sms_deferred) until regional
 *   operational coverage, carrier cost guardrails, and verified delivery callbacks exist.
 * - Deduplication: UNIQUE(subscription_id, alert_id, alert_revision_sent_at) in D1,
 *   plus pre-send `pending_send` claim, `Idempotency-Key`, and KV fallback sent receipt
 *   if transport accepts before D1 `sent` ack succeeds.
 */

import type { SubscriptionCreateRequest, SubscriptionResponse } from '../../shared/contracts';
import { getAuthorityById } from '../../shared/warningRegistry';
import { validateCoordinates } from './firms';
import { matchStoredRecordToPoint, refreshOrLoadAuthoritySnapshot, type FetchLike } from './warnings/adapters';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_DELIVERY_ATTEMPTS = 3;

export interface EmailSendRequest {
	to: string;
	subject: string;
	text: string;
	idempotencyKey: string;
}

export interface EmailTransport {
	mode: 'sandbox' | 'resend';
	send(msg: EmailSendRequest): Promise<{ providerMessageId: string }>;
}

export function createEmailTransport(options: {
	resendApiKey?: string;
	fromAddress?: string;
	fetchImpl?: FetchLike;
}): EmailTransport {
	const apiKey = options.resendApiKey?.trim();
	if (!apiKey) {
		return {
			mode: 'sandbox',
			async send(msg) {
				return { providerMessageId: `sandbox:${msg.idempotencyKey}` };
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
		return { status: 400, body: { ok: false, code: 'invalid_coordinates', message: coordCheck.reason ?? 'Invalid coordinates' } };
	}

	const authority = getAuthorityById(req.sourceId);
	if (!authority) {
		return {
			status: 400,
			body: { ok: false, code: 'unsupported_source', message: 'Selected warning authority is not verified or supported.' },
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

	await options.db
		.prepare(
			`INSERT INTO subscriptions (
				id, channel, destination, place_name, lat, lng, country_code, source_id,
				min_severity, status, confirm_token, unsubscribe_token, created_at
			) VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?, 'pending_confirmation', ?, ?, ?)
			ON CONFLICT(channel, destination, source_id, lat, lng) DO UPDATE SET
				place_name = excluded.place_name,
				min_severity = excluded.min_severity,
				status = CASE WHEN subscriptions.status = 'active' THEN 'active' ELSE 'pending_confirmation' END,
				confirm_token = excluded.confirm_token,
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
			`SELECT id, status, confirm_token FROM subscriptions
			 WHERE channel = 'email' AND destination = ? AND source_id = ? AND lat = ? AND lng = ?`,
		)
		.bind(destination, authority.sourceId, roundedLat, roundedLng)
		.first<{ id: string; status: 'pending_confirmation' | 'active' | 'unsubscribed'; confirm_token: string }>();

	const transportMode = options.transport?.mode ?? 'sandbox';
	const subscriptionId = row?.id ?? id;
	const tokenForConfirm = row?.confirm_token ?? confirmToken;

	if (transportMode === 'resend' && options.transport) {
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
			message:
				'Subscription created in pending confirmation state (sandbox mode). Confirm with your verification token to activate warning alerts.',
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
	if (!clean) {
		return { status: 400, body: { ok: false, code: 'invalid_token', message: 'Confirmation token required.' } };
	}
	const res = await db
		.prepare(
			`UPDATE subscriptions
			 SET status = 'active', confirmed_at = ?, unsubscribed_at = NULL
			 WHERE confirm_token = ?`,
		)
		.bind(now.toISOString(), clean)
		.run();

	if ((res.meta?.changes ?? 0) === 0) {
		return { status: 404, body: { ok: false, code: 'not_found', message: 'Subscription confirmation token not found.' } };
	}

	const row = await db
		.prepare(`SELECT id FROM subscriptions WHERE confirm_token = ?`)
		.bind(clean)
		.first<{ id: string }>();

	return {
		status: 200,
		body: {
			ok: true,
			subscriptionId: row?.id,
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
	const res = await db
		.prepare(
			`UPDATE subscriptions
			 SET status = 'unsubscribed', unsubscribed_at = ?
			 WHERE unsubscribe_token = ? OR id = ?`,
		)
		.bind(now.toISOString(), clean, clean)
		.run();

	if ((res.meta?.changes ?? 0) === 0) {
		return { status: 404, body: { ok: false, code: 'not_found', message: 'Subscription not found.' } };
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

/**
 * Durable outbox dispatch for active verified subscriptions:
 * - Evaluates active warnings per subscribed authority.
 * - Inserts `pending_send` claim (unique on subscription_id + alert_id + revision).
 * - Checks KV sent receipt (`sub:sent:<deliveryId>`) before invoking provider (handles post-accept D1 ack loss).
 * - Sends update/cancel notices for revised or cancelled alerts that had previously been notified.
 */
export async function dispatchVerifiedWarningAlerts(options: {
	db: D1Database | undefined;
	kv?: KVNamespace;
	transport: EmailTransport;
	fetchImpl?: FetchLike;
	now?: Date;
}): Promise<{ processed: number; sent: number; deduplicated: number; failed: number }> {
	if (!options.db) return { processed: 0, sent: 0, deduplicated: 0, failed: 0 };
	const now = options.now ?? new Date();
	const nowIso = now.toISOString();

	const subsRes = await options.db
		.prepare(
			`SELECT id, destination, place_name, lat, lng, country_code, source_id, min_severity, unsubscribe_token
			 FROM subscriptions
			 WHERE status = 'active' AND channel = 'email'
			 LIMIT 200`,
		)
		.all<{
			id: string;
			destination: string;
			place_name: string;
			lat: number;
			lng: number;
			country_code: string;
			source_id: string;
			min_severity: string;
			unsubscribe_token: string;
		}>();

	const subs = subsRes.results ?? [];
	if (subs.length === 0) return { processed: 0, sent: 0, deduplicated: 0, failed: 0 };

	const bySource = new Map<string, typeof subs>();
	for (const s of subs) {
		const list = bySource.get(s.source_id) ?? [];
		list.push(s);
		bySource.set(s.source_id, list);
	}

	let processed = 0;
	let sent = 0;
	let deduplicated = 0;
	let failed = 0;

	for (const [sourceId, sourceSubs] of bySource) {
		const spec = getAuthorityById(sourceId);
		if (!spec) continue;

		const snap = await refreshOrLoadAuthoritySnapshot(spec, {
			kv: options.kv,
			fetchImpl: options.fetchImpl,
			now,
		});
		if (snap.status === 'unavailable') continue;

		for (const sub of sourceSubs) {
			const activeAlertIds = new Set<string>();
			for (const rec of snap.doc.records) {
				const matched = matchStoredRecordToPoint(rec, sub.lat, sub.lng, now);
				if (!matched) continue;
				if (severityRank(matched.severity) < severityRank(sub.min_severity)) continue;
				activeAlertIds.add(matched.identifier);

				processed++;
				const deliveryId = `${sub.id}:${matched.identifier}:${matched.sentAt}`;
				const idempotencyKey = `aegis-alert-${deliveryId}`;
				const block = matched.translations[0];
				const subject = `[AegisMap Official Alert · ${matched.severity.toUpperCase()}] ${block?.headline ?? matched.category} (${sub.place_name})`;
				const text = [
					`Issuer: ${matched.issuerName}`,
					`Severity: ${matched.severity} | Status: ${matched.lifecycleState} (${matched.msgType})`,
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

				// Check KV sent receipt first (protects against prior post-accept DB ack failure)
				const receiptKey = `sub:sent:${deliveryId}`;
				if (options.kv) {
					const alreadyAcked = await options.kv.get(receiptKey).catch(() => null);
					if (alreadyAcked) {
						deduplicated++;
						continue;
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
						deliveryId,
						sub.id,
						matched.identifier,
						matched.sentAt,
						matched.msgType,
						idempotencyKey,
						subject,
						text,
						nowIso,
						nowIso,
					)
					.run();

				const existing = await options.db
					.prepare(`SELECT status, attempts FROM subscription_deliveries WHERE id = ?`)
					.bind(deliveryId)
					.first<{ status: string; attempts: number }>();

				if ((claim.meta?.changes ?? 0) === 0 && existing?.status === 'sent') {
					deduplicated++;
					continue;
				}
				if (existing && existing.attempts >= MAX_DELIVERY_ATTEMPTS) {
					continue;
				}

				try {
					const result = await options.transport.send({
						to: sub.destination,
						subject,
						text,
						idempotencyKey,
					});
					// Write KV fallback receipt immediately so even a DB ack error cannot cause resend
					if (options.kv) {
						await options.kv.put(receiptKey, result.providerMessageId, { expirationTtl: 7 * 86_400 }).catch(() => {});
					}
					await options.db
						.prepare(
							`UPDATE subscription_deliveries
							 SET status = 'sent', attempts = attempts + 1, provider_message_id = ?, last_error = NULL, updated_at = ?
							 WHERE id = ?`,
						)
						.bind(result.providerMessageId, nowIso, deliveryId)
						.run();
					sent++;
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
						.bind(MAX_DELIVERY_ATTEMPTS, msg, nowIso, deliveryId)
						.run();
					failed++;
				}
			}

			// If the upstream snapshot succeeded cleanly, notify once for previously notified alerts that were cancelled/cleared
			if (snap.status === 'ok') {
				const prevSentRes = await options.db
					.prepare(
						`SELECT DISTINCT alert_id
						 FROM subscription_deliveries
						 WHERE subscription_id = ? AND status = 'sent' AND msg_type != 'Cancel'
						 LIMIT 50`,
					)
					.bind(sub.id)
					.all<{ alert_id: string }>();

				for (const prev of prevSentRes.results ?? []) {
					if (activeAlertIds.has(prev.alert_id)) continue;
					const cancelDeliveryId = `${sub.id}:${prev.alert_id}:cancelled`;
					const cancelKey = `aegis-cancel-${cancelDeliveryId}`;
					const receiptKey = `sub:sent:${cancelDeliveryId}`;
					if (options.kv) {
						const alreadyAcked = await options.kv.get(receiptKey).catch(() => null);
						if (alreadyAcked) {
							deduplicated++;
							continue;
						}
					}
					const cancelSubject = `[AegisMap Alert Cleared/Cancelled] ${spec.authorityName} (${sub.place_name})`;
					const cancelText = [
						`Issuer: ${spec.authorityName}`,
						`Previous Alert ID: ${prev.alert_id}`,
						`Status: Cancelled or no longer active at ${nowIso}`,
						`Monitored Area: ${sub.place_name}`,
						`\nUnsubscribe token: ${sub.unsubscribe_token}`,
					].join('\n');

					const claim = await options.db
						.prepare(
							`INSERT OR IGNORE INTO subscription_deliveries (
								id, subscription_id, alert_id, alert_revision_sent_at, msg_type,
								status, attempts, idempotency_key, rendered_subject, rendered_body, created_at, updated_at
							) VALUES (?, ?, ?, 'cancelled', 'Cancel', 'pending_send', 0, ?, ?, ?, ?, ?)`,
						)
						.bind(cancelDeliveryId, sub.id, prev.alert_id, cancelKey, cancelSubject, cancelText, nowIso, nowIso)
						.run();

					const existingCancel = await options.db
						.prepare(`SELECT status, attempts FROM subscription_deliveries WHERE id = ?`)
						.bind(cancelDeliveryId)
						.first<{ status: string; attempts: number }>();

					if ((claim.meta?.changes ?? 0) === 0 && existingCancel?.status === 'sent') {
						deduplicated++;
						continue;
					}
					if (existingCancel && existingCancel.attempts >= MAX_DELIVERY_ATTEMPTS) continue;

					processed++;
					try {
						const result = await options.transport.send({
							to: sub.destination,
							subject: cancelSubject,
							text: cancelText,
							idempotencyKey: cancelKey,
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
							.bind(result.providerMessageId, nowIso, cancelDeliveryId)
							.run();
						sent++;
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
							.bind(MAX_DELIVERY_ATTEMPTS, msg, nowIso, cancelDeliveryId)
							.run();
						failed++;
					}
				}
			}
		}
	}

	return { processed, sent, deduplicated, failed };
}
