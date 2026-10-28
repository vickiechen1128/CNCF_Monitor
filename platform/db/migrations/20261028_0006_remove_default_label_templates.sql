-- +goose Up
DELETE FROM label_templates WHERE is_default = TRUE;

-- +goose Down
-- 预置默认模板不再恢复。
