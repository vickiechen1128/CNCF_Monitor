-- +goose Up
CREATE INDEX IF NOT EXISTS idx_edge_heartbeats_domain_timestamp
  ON edge_heartbeats(network_domain_id, timestamp);

-- +goose Down
DROP INDEX IF EXISTS idx_edge_heartbeats_domain_timestamp;
