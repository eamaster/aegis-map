-- Additive D1 schema for historical disaster archive, revision tracking,
-- ingestion checkpoints, provider health telemetry, and opt-in subscriptions.

CREATE TABLE IF NOT EXISTS disaster_events (
	id TEXT PRIMARY KEY,
	upstream_id TEXT NOT NULL,
	source TEXT NOT NULL,
	type TEXT NOT NULL,
	title TEXT NOT NULL,
	lat REAL NOT NULL,
	lng REAL NOT NULL,
	severity TEXT NOT NULL,
	magnitude REAL,
	area_acres REAL,
	event_time TEXT NOT NULL,
	first_seen_at TEXT NOT NULL,
	ingested_at TEXT NOT NULL,
	is_backfill INTEGER NOT NULL DEFAULT 0,
	attribution TEXT NOT NULL,
	gdacs_match_id TEXT,
	revision_hash TEXT NOT NULL,
	UNIQUE(source, upstream_id)
);

CREATE INDEX IF NOT EXISTS idx_disaster_events_time ON disaster_events(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_disaster_events_type_time ON disaster_events(type, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_disaster_events_lat_lng ON disaster_events(lat, lng);

CREATE TABLE IF NOT EXISTS disaster_revisions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	event_id TEXT NOT NULL,
	revision_number INTEGER NOT NULL,
	observed_at TEXT NOT NULL,
	title TEXT NOT NULL,
	severity TEXT NOT NULL,
	lat REAL NOT NULL,
	lng REAL NOT NULL,
	source_timestamp TEXT NOT NULL,
	revision_hash TEXT NOT NULL,
	UNIQUE(event_id, revision_hash),
	FOREIGN KEY(event_id) REFERENCES disaster_events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_disaster_revisions_event ON disaster_revisions(event_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
	source TEXT NOT NULL,
	window_key TEXT NOT NULL,
	cursor TEXT,
	last_event_time TEXT,
	updated_at TEXT NOT NULL,
	status TEXT NOT NULL,
	records_processed INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY(source, window_key)
);

CREATE TABLE IF NOT EXISTS provider_health_runs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	provider TEXT NOT NULL,
	run_at TEXT NOT NULL,
	status TEXT NOT NULL,
	latency_ms INTEGER NOT NULL,
	record_count INTEGER NOT NULL DEFAULT 0,
	rejected_count INTEGER NOT NULL DEFAULT 0,
	error_detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_provider_health_provider_time ON provider_health_runs(provider, run_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
	id TEXT PRIMARY KEY,
	channel TEXT NOT NULL,
	destination TEXT NOT NULL,
	place_name TEXT NOT NULL,
	lat REAL NOT NULL,
	lng REAL NOT NULL,
	country_code TEXT NOT NULL,
	source_id TEXT NOT NULL,
	min_severity TEXT NOT NULL DEFAULT 'moderate',
	status TEXT NOT NULL,
	confirm_token TEXT NOT NULL,
	unsubscribe_token TEXT NOT NULL,
	created_at TEXT NOT NULL,
	confirmed_at TEXT,
	unsubscribed_at TEXT,
	UNIQUE(channel, destination, source_id, lat, lng)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(status, source_id);

CREATE TABLE IF NOT EXISTS subscription_deliveries (
	id TEXT PRIMARY KEY,
	subscription_id TEXT NOT NULL,
	alert_id TEXT NOT NULL,
	alert_revision_sent_at TEXT NOT NULL,
	msg_type TEXT NOT NULL,
	status TEXT NOT NULL,
	attempts INTEGER NOT NULL DEFAULT 0,
	idempotency_key TEXT NOT NULL,
	provider_message_id TEXT,
	rendered_subject TEXT,
	rendered_body TEXT,
	last_error TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE(subscription_id, alert_id, alert_revision_sent_at),
	FOREIGN KEY(subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deliveries_status ON subscription_deliveries(status, updated_at);
