# 设计专题：配置生成与原子发布

> 所属模块：M09 配置与查询中心
> 对应 SRS：FR-10 ~ FR-14、NFR-04 ~ NFR-06
> 关联代码：`platform/modules/m09/service/config_sync_service.go`、`config_trigger_service.go`、`configcenter/generator/`、`storage/content_store.go`
> 状态：已实现

---

## 1. 目标与不变量

- 源数据（M01 采集策略/规则、M07 资源/标签模板）变化后，自动生成当前网域配置；
- 校验通过才发布；**失败不覆盖 current**，避免监控断点；
- 每 scope+scope_key 只有一个 current；
- 边缘配置包不含 `rules.yml`（D35）；中心规则单独生成并 reload 中心 Prometheus；
- 历史只读、不可回滚；按自然日保留 30 天、每天最多一份成功版本。

---

## 2. 触发源与节流

| 来源 | 触发 | 兜底 |
|------|------|------|
| M01 Job/规则保存 | best-effort 即时触发 | 30s watcher + 60s M01 对账 |
| M07 资源/标签模板/导入/批量变更 | 先触发 M01 对账回收失效选例，再触发 M09 | 同上 |
| 定时 | 30s watcher | — |

即时触发器 `ConfigTriggerService`：

- 500ms 防抖，合并批量编辑；
- 最多等待 5s 后执行，避免长时间饥饿；
- 单次触发按网域 + 中心规则分别处理，失败只记录日志，不阻塞其他域。

---

## 3. 生成输入与产物

输入：M01 Job/规则、M07 资源/标签模板、网域元数据、标签注入规则。

产物（`configcenter/generator`）：

```text
prometheus.yml      # scrape_configs + file_sd 引用 + external_labels
targets/*.json      # file_sd 目标，按 Job/网域拆分
blackbox.yml        # 拨测模块（如启用）
metadata.json       # 回传参数等
rules.yml           # 仅中心 scope（D35）
```

标签边界：

- 数据面仅保留 `network_domain_id`；不注入 `tenant`、`zone_type` 等（D28/D33）；
- 租户标签由 M07 LabelTemplate 的 target 级映射提供，不在 `external_labels` 中伪造。

---

## 4. 校验

| 产物 | 校验 |
|------|------|
| prometheus.yml | `promtool check config` |
| blackbox.yml | blackbox exporter 配置校验 |
| targets/*.json | JSON/schema 结构校验 |
| rules.yml | `promtool check rules` + job 引用校验 |

失败归因：

- `user_config`：用户配置问题（如非法端口、无效 Job 引用）；
- `platform_fault`：平台渲染/环境问题。

失败处理：

- 不写新版本、不切换 current；
- 回写 M01 `sync_status/sync_error`；
- 记录日志，供排障；失败尝试不进入配置产物历史。

---

## 5. 原子发布

```text
1. 渲染到临时目录
2. 校验
3. 内容写入 content store（version/checksum）
4. 事务内插入新行 + 将旧 current 置 false + 新行置 current
5. 中心规则：原子写 config-output + 触达 Prometheus /-/reload
6. 失败：回滚事务/保留旧 current
```

唯一索引保证 `(scope, scope_key) WHERE is_current` 只有一行；并发发布由数据库约束兜底。

---

## 6. 历史与保留

- 网域配置/中心规则：自然日 + 30 天；每天最多一份成功版本；同一天多次成功只保留最后一份；current 始终保留；
- 告警配置：M08 的 20 份策略，M09 只读引用；
- 日切时区/天数可配置：`METRIC_CENTER_SNAPSHOT_TIMEZONE`、`METRIC_CENTER_SNAPSHOT_RETENTION_DAYS`；
- 清理按日裁剪，失败只记录日志，不阻塞发布。

---

## 7. 节点侧应用

- 节点心跳返回 `config_changed`、`config_version`、`checksum`、下载地址；
- `GET /api/v3/edge/config` 返回 zip；`ETag` 未变时 304；
- 节点应用失败通过心跳 `config_apply_error` / `config_apply_failed_version` 回写；
- 节点状态推导为 `out_of_sync/apply_failed`，前端高亮。

---

## 8. 测试矩阵

| 场景 | 期望 |
|------|------|
| 校验通过 | 新版本成为 current，旧 current 转历史 |
| 校验失败 | current 不变，回写 sync_error，不写历史 |
| 同一天多次成功 | 只保留当日最后一份 |
| 超过 30 天 | 旧日版本被裁剪，current 保留 |
| 并发发布 | 唯一约束保证仅一个 current |
| 中心规则 reload 失败 | 保留 current，记录日志 |
| 节点配置包 ETag 匹配 | 304，不重复下载 |
| 节点应用失败 | 心跳回写 apply_failed，状态 out_of_sync |
