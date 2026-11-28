/**
 * Test-only ephemeral Web Push cryptographic fixture generator (Node 22 + Cloudflare Workers Web Crypto).
 * Generates fresh P-256 VAPID key pairs and P-256 ECDH subscriber keys + 16-byte auth secrets at runtime.
 * Never import this helper from production bundles (`frontend/src/` or `backend/src/`).
 */

function toBase64Url(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a fresh ephemeral ECDSA P-256 VAPID key pair for automated tests.
 */
export async function generateEphemeralVapidKeys() {
	const kp = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify'],
	);
	const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
	const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
	return {
		publicKey: toBase64Url(rawPub),
		privateKey: JSON.stringify({ ...privateJwk, key_ops: ['sign'], ext: true }),
		privateJwk: { ...privateJwk, key_ops: ['sign'], ext: true },
		publicKeyObj: kp.publicKey,
	};
}

/**
 * Generate a fresh ephemeral ECDH P-256 subscriber key pair and 16-byte random auth secret.
 */
export async function generateEphemeralClientPushKeys() {
	const kp = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveBits'],
	);
	const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
	const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
	const authBytes = crypto.getRandomValues(new Uint8Array(16));
	return {
		p256dh: toBase64Url(rawPub),
		auth: toBase64Url(authBytes),
		privateJwk,
	};
}
