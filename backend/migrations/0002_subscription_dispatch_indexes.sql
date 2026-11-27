-- Additive indexes for deterministic resumable subscription dispatch
-- and bounded delivery retry/history scans.

CREATE INDEX IF NOT EXISTS idx_subscriptions_dispatch_cursor
	ON subscriptions(status, channel, id ASC);

CREATE INDEX IF NOT EXISTS idx_deliveries_sub_status_alert
	ON subscription_deliveries(subscription_id, status, id ASC);
