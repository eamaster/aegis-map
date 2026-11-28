/**
 * Native Web Crypto Web Push (VAPID RFC 8292 + AES128GCM Payload Encryption RFC 8291 / 8188).
 * Zero external runtime dependencies; compatible with Cloudflare Workers and Node 22 Web Crypto.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_WEBPUSH_PLAINTEXT_BYTES = 3072;
const VAPID_TTL_SECONDS = 12 * 3600;

export class PushEndpointGoneError extends Error {
	readonly httpStatus: number;
	constructor(httpStatus: number) {
		super(`Push subscription endpoint expired or gone (HTTP ${httpStatus})`);
		this.name = 'PushEndpointGoneError';
		this.httpStatus = httpStatus;
	}
}

export function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(input: string): Uint8Array {
	const cleaned = input.trim().replace(/-/g, '+').replace(/_/g, '/');
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
		throw new Error('Invalid base64url string');
	}
	const padded = cleaned.padEnd(Math.ceil(cleaned.length / 4) * 4, '=');
	const binary = atob(padded);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
}

function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
	const total = chunks.reduce((acc, c) => acc + c.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

function isDisallowedPrivateHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host === '0.0.0.0'
	) {
		return true;
	}
	if (host.includes(':')) {
		if (
			host === '::' ||
			host === '::1' ||
			host.startsWith('fc') ||
			host.startsWith('fd') ||
			host.startsWith('fe80')
		) {
			return true;
		}
	}
	const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (ipv4Match) {
		const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
		if (a === 10 || a === 127 || a === 0) return true;
		if (a === 169 && b === 254) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 100 && b >= 64 && b <= 127) return true;
	}
	return false;
}

export function validatePushEndpoint(
	urlStr: string,
	options: { allowLocalTest?: boolean } = {},
): { ok: true; url: URL } | { ok: false; reason: string } {
	if (typeof urlStr !== 'string' || urlStr.trim().length === 0 || urlStr.length > 2048) {
		return { ok: false, reason: 'Push endpoint URL is required and must be <= 2048 characters.' };
	}
	let parsed: URL;
	try {
		parsed = new URL(urlStr.trim());
	} catch {
		return { ok: false, reason: 'Invalid push endpoint URL.' };
	}
	if (parsed.username || parsed.password || parsed.hash) {
		return { ok: false, reason: 'Push endpoint must not include credentials or URL fragments.' };
	}
	const isLocalHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
	if (options.allowLocalTest && parsed.protocol === 'http:' && isLocalHost) {
		return { ok: true, url: parsed };
	}
	if (parsed.protocol !== 'https:') {
		return { ok: false, reason: 'Push endpoint must use HTTPS.' };
	}
	if (!options.allowLocalTest && isDisallowedPrivateHost(parsed.hostname)) {
		return { ok: false, reason: 'Private or loopback push endpoints are rejected.' };
	}
	return { ok: true, url: parsed };
}

export function validatePushKeyMaterial(p256dh: string, auth: string): { ok: true } | { ok: false; reason: string } {
	try {
		const pubBytes = base64UrlDecode(p256dh);
		if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
			return { ok: false, reason: 'Push subscription p256dh key must be an uncompressed 65-byte P-256 point.' };
		}
		const authBytes = base64UrlDecode(auth);
		if (authBytes.length !== 16) {
			return { ok: false, reason: 'Push subscription auth secret must be 16 bytes.' };
		}
		return { ok: true };
	} catch {
		return { ok: false, reason: 'Malformed Web Push encryption keys.' };
	}
}

export interface VapidConfig {
	publicKey: string;
	privateJwk: JsonWebKey;
	subject: string;
}

export function parseVapidConfig(options: {
	publicKey?: string;
	privateKey?: string;
	subject?: string;
}): VapidConfig | null {
	const pub = options.publicKey?.trim();
	const priv = options.privateKey?.trim();
	const subject = options.subject?.trim();
	if (!pub || !priv || !subject) return null;
	if (!subject.startsWith('mailto:') && !subject.startsWith('https://')) return null;

	let pubBytes: Uint8Array;
	try {
		pubBytes = base64UrlDecode(pub);
	} catch {
		return null;
	}
	if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) return null;

	const x = base64UrlEncode(pubBytes.slice(1, 33));
	const y = base64UrlEncode(pubBytes.slice(33, 65));

	if (priv.startsWith('{')) {
		try {
			const parsed = JSON.parse(priv) as JsonWebKey;
			if (parsed.kty === 'EC' && parsed.crv === 'P-256' && typeof parsed.d === 'string') {
				return {
					publicKey: pub,
					privateJwk: { ...parsed, x: parsed.x ?? x, y: parsed.y ?? y, key_ops: ['sign'], ext: true },
					subject,
				};
			}
		} catch {
			return null;
		}
	}

	try {
		const dBytes = base64UrlDecode(priv);
		if (dBytes.length !== 32) return null;
		return {
			publicKey: pub,
			privateJwk: {
				kty: 'EC',
				crv: 'P-256',
				x,
				y,
				d: base64UrlEncode(dBytes),
				key_ops: ['sign'],
				ext: true,
			},
			subject,
		};
	} catch {
		return null;
	}
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, data);
	return new Uint8Array(sig);
}

/**
 * Encrypt plaintext per RFC 8291 (Message Encryption for Web Push) and RFC 8188 (`aes128gcm`).
 */
export async function encryptWebPushPayload(
	plaintext: Uint8Array,
	clientP256dhBase64Url: string,
	clientAuthBase64Url: string,
	options: { salt?: Uint8Array } = {},
): Promise<Uint8Array> {
	if (plaintext.byteLength > MAX_WEBPUSH_PLAINTEXT_BYTES) {
		throw new Error(`Push payload exceeds ${MAX_WEBPUSH_PLAINTEXT_BYTES} bytes`);
	}
	const keyCheck = validatePushKeyMaterial(clientP256dhBase64Url, clientAuthBase64Url);
	if (!keyCheck.ok) {
		throw new Error(keyCheck.reason);
	}

	const uaPublic = base64UrlDecode(clientP256dhBase64Url);
	const authSecret = base64UrlDecode(clientAuthBase64Url);

	const asKeyPair = (await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveBits'],
	)) as CryptoKeyPair;
	const asPublicRaw = new Uint8Array((await crypto.subtle.exportKey('raw', asKeyPair.publicKey)) as ArrayBuffer);
	const uaPublicKey = await crypto.subtle.importKey(
		'raw',
		uaPublic,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[],
	);

	const sharedSecret = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'ECDH', public: uaPublicKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0],
			asKeyPair.privateKey,
			256,
		),
	);

	const enc = new TextEncoder();
	const prkKey = await hmacSha256(authSecret, sharedSecret);
	const keyInfo = concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublicRaw);
	const ikm = await hmacSha256(prkKey, concatBytes(keyInfo, new Uint8Array([0x01])));

	const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
	if (salt.length !== 16) throw new Error('Salt must be 16 bytes');
	const prk = await hmacSha256(salt, ikm);

	const cekFull = await hmacSha256(prk, concatBytes(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([0x01])));
	const cekBytes = cekFull.slice(0, 16);
	const nonceFull = await hmacSha256(prk, concatBytes(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([0x01])));
	const nonceBytes = nonceFull.slice(0, 12);

	const record = concatBytes(plaintext, new Uint8Array([0x02]));
	const aesKey = await crypto.subtle.importKey('raw', cekBytes, { name: 'AES-GCM' }, false, ['encrypt']);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceBytes, tagLength: 128 }, aesKey, record),
	);

	const header = new Uint8Array(21 + asPublicRaw.length);
	header.set(salt, 0);
	const view = new DataView(header.buffer);
	view.setUint32(16, 4096, false);
	header[20] = asPublicRaw.length;
	header.set(asPublicRaw, 21);

	return concatBytes(header, ciphertext);
}

/**
 * Reference RFC 8291/8188 decryptor used in automated tests to verify real end-to-end encryption.
 */
export async function decryptWebPushPayloadForTest(
	body: Uint8Array,
	uaPrivateJwk: JsonWebKey,
	clientP256dhBase64Url: string,
	clientAuthBase64Url: string,
): Promise<Uint8Array> {
	if (body.length < 22) throw new Error('Truncated aes128gcm body');
	const salt = body.slice(0, 16);
	const keyIdLen = body[20];
	const asPublicRaw = body.slice(21, 21 + keyIdLen);
	const ciphertext = body.slice(21 + keyIdLen);

	const uaPublic = base64UrlDecode(clientP256dhBase64Url);
	const authSecret = base64UrlDecode(clientAuthBase64Url);

	const uaPrivateKey = await crypto.subtle.importKey(
		'jwk',
		uaPrivateJwk,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveBits'],
	);
	const asPublicKey = await crypto.subtle.importKey(
		'raw',
		asPublicRaw,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[],
	);
	const sharedSecret = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'ECDH', public: asPublicKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0],
			uaPrivateKey,
			256,
		),
	);

	const enc = new TextEncoder();
	const prkKey = await hmacSha256(authSecret, sharedSecret);
	const keyInfo = concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublicRaw);
	const ikm = await hmacSha256(prkKey, concatBytes(keyInfo, new Uint8Array([0x01])));
	const prk = await hmacSha256(salt, ikm);
	const cek = (await hmacSha256(prk, concatBytes(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([0x01])))).slice(0, 16);
	const nonce = (await hmacSha256(prk, concatBytes(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([0x01])))).slice(0, 12);

	const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
	const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, ciphertext));
	let end = decrypted.length - 1;
	while (end >= 0 && decrypted[end] === 0x00) end--;
	if (end < 0 || decrypted[end] !== 0x02) {
		throw new Error('Invalid aes128gcm padding delimiter');
	}
	return decrypted.slice(0, end);
}

/**
 * Build VAPID `Authorization` header per RFC 8292 (ES256 P-256).
 */
export async function buildVapidAuthorizationHeader(options: {
	endpointUrl: URL;
	config: VapidConfig;
	nowSec?: number;
}): Promise<string> {
	const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
	const enc = new TextEncoder();
	const headerB64 = base64UrlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
	const claimsB64 = base64UrlEncode(
		enc.encode(
			JSON.stringify({
				aud: options.endpointUrl.origin,
				exp: nowSec + VAPID_TTL_SECONDS,
				sub: options.config.subject,
			}),
		),
	);
	const signingInput = `${headerB64}.${claimsB64}`;
	const signingKey = await crypto.subtle.importKey(
		'jwk',
		options.config.privateJwk,
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign'],
	);
	const signature = new Uint8Array(
		await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, enc.encode(signingInput)),
	);
	return `vapid t=${signingInput}.${base64UrlEncode(signature)}, k=${options.config.publicKey}`;
}

/**
 * Derive a deterministic, collision-resistant RFC 8030 Topic header (<= 32 URL-safe characters).
 * Prevents push-service message replacement collisions when distinct long CAP identifiers share a prefix.
 */
export async function buildPushTopic(alertId: string, msgType: string): Promise<string> {
	const input = new TextEncoder().encode(`${alertId}\0${msgType}`);
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
	// 18 bytes -> 24 base64url chars; prefixed with 'am_' -> 27 chars (strictly <= 32 RFC 8030 Topic limit)
	return `am_${base64UrlEncode(digest.slice(0, 18))}`;
}

export interface WebPushSendRequest {
	endpoint: string;
	p256dh: string;
	auth: string;
	payloadJson: string;
	topic: string;
	urgency: 'very-low' | 'low' | 'normal' | 'high';
	ttlSeconds?: number;
}

export interface WebPushTransport {
	mode: 'web_push' | 'sandbox' | 'disabled';
	getVapidPublicKey(): Promise<string | undefined>;
	send(msg: WebPushSendRequest): Promise<{ providerMessageId: string }>;
}

let cachedSandboxVapidPromise: Promise<VapidConfig> | null = null;

async function getSandboxVapidConfig(): Promise<VapidConfig> {
	if (!cachedSandboxVapidPromise) {
		cachedSandboxVapidPromise = (async () => {
			const kp = (await crypto.subtle.generateKey(
				{ name: 'ECDSA', namedCurve: 'P-256' },
				true,
				['sign', 'verify'],
			)) as CryptoKeyPair;
			const rawPub = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
			const privateJwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey;
			return {
				publicKey: base64UrlEncode(rawPub),
				privateJwk: { ...privateJwk, key_ops: ['sign'], ext: true },
				subject: 'mailto:sandbox-push@aegis-map.local',
			};
		})();
	}
	return cachedSandboxVapidPromise;
}

export function createWebPushTransport(options: {
	vapidPublicKey?: string;
	vapidPrivateKey?: string;
	vapidSubject?: string;
	allowSandbox?: boolean;
	allowLocalEndpoints?: boolean;
	fetchImpl?: FetchLike;
}): WebPushTransport {
	const parsed = parseVapidConfig({
		publicKey: options.vapidPublicKey,
		privateKey: options.vapidPrivateKey,
		subject: options.vapidSubject,
	});

	if (!parsed && !options.allowSandbox) {
		return {
			mode: 'disabled',
			async getVapidPublicKey() {
				return undefined;
			},
			async send() {
				throw new Error('Web Push delivery transport is disabled (VAPID keys not configured)');
			},
		};
	}

	const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const allowLocal = Boolean(options.allowLocalEndpoints || options.allowSandbox);
	const mode: 'web_push' | 'sandbox' = parsed ? 'web_push' : 'sandbox';
	const resolveConfig = () => (parsed ? Promise.resolve(parsed) : getSandboxVapidConfig());

	return {
		mode,
		async getVapidPublicKey() {
			const cfg = await resolveConfig();
			return cfg.publicKey;
		},
		async send(msg) {
			const endpointCheck = validatePushEndpoint(msg.endpoint, { allowLocalTest: allowLocal });
			if (!endpointCheck.ok) {
				throw new Error(endpointCheck.reason);
			}
			const cfg = await resolveConfig();
			const encrypted = await encryptWebPushPayload(
				new TextEncoder().encode(msg.payloadJson),
				msg.p256dh,
				msg.auth,
			);
			const authorization = await buildVapidAuthorizationHeader({
				endpointUrl: endpointCheck.url,
				config: cfg,
			});

			// Sandbox transport is strictly isolated: unless an explicit fetchImpl (unit test) or
			// local loopback test receiver is used, never initiate outbound network requests to real push providers.
			const isLoopback =
				endpointCheck.url.hostname === '127.0.0.1' || endpointCheck.url.hostname === 'localhost';
			if (mode === 'sandbox' && !options.fetchImpl && !isLoopback) {
				return { providerMessageId: `sandbox-push:${crypto.randomUUID()}` };
			}

			const safeTopic = /^[A-Za-z0-9_-]{1,32}$/.test(msg.topic)
				? msg.topic
				: await buildPushTopic(msg.topic, 'topic');

			const res = await fetchImpl(endpointCheck.url.href, {
				method: 'POST',
				headers: {
					Authorization: authorization,
					'Content-Encoding': 'aes128gcm',
					'Content-Type': 'application/octet-stream',
					TTL: String(msg.ttlSeconds ?? 3600),
					Urgency: msg.urgency,
					Topic: safeTopic,
				},
				body: encrypted,
				signal: AbortSignal.timeout(8_000),
			});

			if (res.status === 404 || res.status === 410) {
				throw new PushEndpointGoneError(res.status);
			}
			if (!res.ok) {
				throw new Error(`Push provider HTTP ${res.status}`);
			}
			const location = res.headers.get('location') ?? res.headers.get('x-message-id');
			return { providerMessageId: location || `webpush:${Date.now()}` };
		},
	};
}
