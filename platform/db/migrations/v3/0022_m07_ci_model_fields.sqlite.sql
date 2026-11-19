-- +goose Up
-- M07 CI 模型配置（SRS Module_07 v2.2 §5.8 FR-30~FR-34）：
-- 自定义字段增加「在模型中 / 已移出」状态、展示分组与组内排序；
-- 内置字段不落库（由平台代码定义），因此本迁移只改自定义字段表。
--
-- 状态口径：active = 在模型中（表单渲染）；removed = 已移出（表单不渲染、值保留）。
-- 不设「停用」状态。旧 enabled=false 的行按「已移出」迁移，enabled 列保留只读兼容。

ALTER TABLE m07_attribute_definitions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE m07_attribute_definitions
  ADD COLUMN display_group TEXT NOT NULL DEFAULT 'profile';
ALTER TABLE m07_attribute_definitions
  ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;

UPDATE m07_attribute_definitions SET status = 'removed' WHERE enabled = 0;

CREATE INDEX IF NOT EXISTS idx_m07_attribute_definitions_category_status
  ON m07_attribute_definitions(resource_category, status)
  WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_m07_attribute_definitions_category_status;
ALTER TABLE m07_attribute_definitions DROP COLUMN display_order;
ALTER TABLE m07_attribute_definitions DROP COLUMN display_group;
ALTER TABLE m07_attribute_definitions DROP COLUMN status;
