export interface EphemeralVapidKeys {
	publicKey: string;
	privateKey: string;
	privateJwk: JsonWebKey;
	publicKeyObj: CryptoKey;
}

export interface EphemeralClientPushKeys {
	p256dh: string;
	auth: string;
	privateJwk: JsonWebKey;
}

export function generateEphemeralVapidKeys(): Promise<EphemeralVapidKeys>;
export function generateEphemeralClientPushKeys(): Promise<EphemeralClientPushKeys>;
