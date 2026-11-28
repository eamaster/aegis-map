-- Additive migration for opt-in Web Push delivery keys (RFC 8291 P-256 ECDH).
-- Email subscriptions continue using subscriptions without modification.

CREATE TABLE IF NOT EXISTS push_subscription_keys (
	subscription_id TEXT PRIMARY KEY,
	p256dh TEXT NOT NULL,
	auth TEXT NOT NULL,
	expiration_time INTEGER,
	user_locale TEXT,
	updated_at TEXT NOT NULL,
	FOREIGN KEY(subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);
