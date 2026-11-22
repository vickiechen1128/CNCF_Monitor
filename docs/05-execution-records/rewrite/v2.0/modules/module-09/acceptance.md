# Module 09 验收标准（acceptance）

> **状态**：frozen（B0 评审通过，owner 2026-11-11 确认；随实施回填测试证据）
> **分支**：`rewrite/v2.0`
> **权威需求**：M09 SRS v1.10 §5（功能需求 FR-01~22）、§6（非功能需求 NFR-01~13）、§9（验收标准）
> **关联任务**：`backend-task-sequence.yaml`
> **说明**：证据列在对应任务完成后回填测试名 / 命令 / 记录；未达标项登记为 open。

---

## 1. 功能验收（FR）

| FR | 需求 | 实现任务 | 验证方式 | 证据 | 状态 |
|---|---|---|---|---|---|
| FR-01 | 已登记网域纳管，自动签发 Token，单网域单生效 Token | T09-B3-2 | handler 单测：纳管成功/重复 409/非 enabled 域 400 | service/handler 单测：monitor 成功签发并落单行 token_hash；重复纳管 409；disabled 域 400；重置覆盖旧 hash | done |
| FR-02 | Token 生成/重置/废止；UI 完全脱敏；重置旧 Token 立即失效；退纳管废止 | T09-B3-2 / T09-B4-1 | 单测：明文仅签发/重置响应；重置后旧 Token 心跳 401；grep 无明文落库/日志 | domain/service 单测：仅存 sha256；列表/详情无 token 字段；重置后 TokenMatches(旧)=false；退纳管清空 hash；B4 心跳无/无效 Token 401、重置后旧 Token 校验失败 | done |
| FR-03 | 统一安装指引（下载→解压→配置 CENTER_ENDPOINT+Token→启动→心跳回连）+ 离线包 sha256 | T09-B3-2 / T09-B7-1 | 契约测试：install_guide 步骤齐全；下载含 sha256 | monitor 响应返回 4 步 install_guide + package_download_url；B7 离线包清单含 sha256，下载返回 ETag/X-Checksum-Sha256 | done |
| FR-04 | 纳管状态机 created/monitored；v0.2+ 退纳管归 created；M06 删除级联清退 | T09-B3-2 / T09-V1-1 | 单测 + e2e：状态机转换；M06 删除触发 m09 清退（废止 Token + 节点 retired + 清快照） | 状态机/退纳管归 created/ MonitoringRetirer 级联（Token 废止 + 节点 retired + 清 target/config 快照，幂等）单测通过；M06 删除端到端 e2e 待 V1-1 | partial |
| FR-05 | EdgeAgent 首次有效 Token 心跳自动注册，记录域/主机/IP/版本/组件 | T09-B4-1 | 单测：首次心跳创建记录；域内 hostname 唯一 | service 单测：首次心跳按 (domain,hostname) 创建并置 online；重复心跳原地更新不新增；组件/collector 版本落库 | done |
| FR-06 | 心跳接收状态/组件/快照/回传指标；在线离线判定；7 天保留清理 | T09-B4-1 / T09-B4-2 | 单测：超时→offline；清理 worker 删除 >7 天 | 心跳指标/组件/快照落库；有效状态按 90s 心跳年龄派生；DetectOffline 与 CleanupHeartbeats(7d) 单测通过；v3 bootstrap 已接线每 1 分钟维护循环 | done |
| FR-07 | 节点列表展示配置版本/校验和；待同步；失败原因 | T09-B4-3 | 契约测试：config_sync_status / out_of_sync_cause 字段 | 节点视图已返回 config_version/config_sync_status/out_of_sync_cause/config_apply_error；同步状态由上报版本 vs 当前版本 + apply 失败推导；快照 checksum 已在 B5 落库，节点视图透出 checksum 为后续增量 | partial |
| FR-08 | 组件运行态 + crash-loop 观测 + 高亮 | T09-B4-3 | 单测：components JSON；crash_loop 状态透传 | components 以 JSON 落库并按原样透传（含 status/restart_count/last_restart_at）；crash_loop 为纯透传枚举，前端高亮属前端范围 | done |
| FR-09 | 心跳响应透传重启/清空积压指令；seq 幂等；中心不入站 | T09-B4-1 / T09-B4-3 | 单测：seq 重复不重复执行；offline 禁用触发；安全审查无入站连接 | restart/flush 递增 seq 并留痕，offline/retired 拒绝；心跳响应回传 seq；中心仅被动响应（无入站）；agent 侧幂等执行属 A 线 | partial |
| FR-10 | 监听 M01/M07 变化，按域生成配置；失败不覆盖当前版本 | T09-B5-2 | 单测：源变更触发生成；失败保留旧 current | 已实现 M07 资源源（host/db/mw/generic）生成、per-domain 锁、RunWatcher 指纹轮询（bootstrap 已接线，首轮立即）、失败仅记 failed 不覆盖；M01 ScrapeJob/Rule 源接入待 M01 v3 | partial |
| FR-11 | 配置包供节点拉取；心跳响应 config_changed + 下载地址/校验和；含凭据仅 Token 校验返回 | T09-B4-4 / T09-B4-1 / T09-A1-2 | 单测：304/200/404；无 Token 拒绝 | 心跳按当前 passed 快照回填 config_changed/config_version/config_checksum + 绝对 config_download_url；/api/v3/edge/config 返回 zip（prometheus.yml/targets/metadata）+ ETag=checksum，304 命中；agent 已切换 v3 路由并携带 If-None-Match | done |
| FR-12 | 生成产物 promtool/blackbox/targets 校验；失败标记不发布；区分 user_config/platform_fault | T09-B5-2 | 单测：校验失败不切换；归因字段正确 | 校验复用 generator.ValidateArtifacts（promtool/blackbox/targets），pending 归一为 failed+platform_fault；失败不切换；内容写盘失败记 platform_fault。真实外部工具场景待联调 | partial |
| FR-13 | 保留最近 3~5 份只读历史；不支持回滚；超量自动清理 | T09-B5-2 / T09-B5-3 | 单测：保留数上限；grep 无 rollback 端点 | 保留 5 份（含 current）自动清理元数据+内容；路由扫描单测断言无 confirm/rollback/restore/revalidate/discard/deployments | done |
| FR-14 | M08 告警配置纳入统一历史（D51）；不单维护变更确认 | T09-B5-3 | 单测：统一历史可读 alertmanager scope；无确认流程 | D51 修订：M08 单份持久化，M09 只读引用，不再使用 AlertmanagerSnapshotSink / am- 镜像；导出/恢复包覆盖 | done |
| FR-15 | /api/v1/targets 融合中心 + 边缘快照；字段齐全 | T09-B6-1 | 单测：融合去重；source 标注；字段映射 | 边缘快照按契约字段返回（job/instance/network_domain/instance_name/health/last_scrape/last_error/source）；中心 Prometheus targets 融合暂未接入（v3 中心无自有 scrape） | partial |
| FR-16 | /api/v1/health/coverage 三态，供 M07 消费 | T09-B6-1 | 单测：三态计数口径 | service 单测：新鲜且 up=采集中；过期/非 up=已下发未采到；无匹配快照的 online 资源=未监控 | done |
| FR-17 | targets 按网域/Job/健康/关键字筛选 + 分页 | T09-B6-1 | 契约测试：筛选与分页信封 | 筛选（network_domain/job/health/keyword）+ 分页（20/100）与健康派生（stale→unknown）单测通过 | done |
| FR-18 | /api/v1/query* 代理 Prometheus 原生接口 | T09-B6-2 | 单测：query/query_range/labels/series/alerts 透传 | query/query_range/labels/label values/series/alerts 全部挂载并代理；仅 v3-only（D30）；单测以 httptest 上游验证透传 | done |
| FR-19 | 统一响应 envelope + meta{data_source,freshness_at,network_domains} | T09-B6-2 | 契约测试：meta 字段齐全 | 成功响应外层追加 meta（data_source/freshness_at/network_domains），保留 Prometheus status/data；handler 单测断言 | done |
| FR-20 | 服务端按租户解析授权网域集，转发前注入 `network_domain` 单标签约束；不注入 `tenant`；无 bypass；越权不可见 | T09-B6-2 / T09-V1-1 | 单测 + e2e：注入 `network_domain` 匹配器；断言未注入 `tenant`；越权返回空；admin 无 bypass | 按租户缓存解析授权域（platform_admin 亦无 bypass）；PromQL/match[] 注入 `network_domain_id=~"..."`（D33：与数据面标签一致）；未注入 tenant；越权/无标签返回空；单测覆盖 | done |
| FR-21 | 离线包版本管理；节点版本与中心最新差异；升级指引 + 下载 | T09-B7-1 / T09-B4-3 | 单测：清单/sha256；版本字段供前端比对 | /edge-packages、/latest、/:file 落地；清单含 version/file/sha256/size_bytes/released_at/components；流式下载 + ETag/X-Checksum + 304；节点版本差异由前端比对 /edge-agents 与清单 | done |
| FR-22 | 指标查询页面：PromQL/辅助选择、时间范围、执行/取消、时序图（断点/0 区分）、明细、元信息、URL、预设、状态完整 | 本次增量 | 前端单测 + 手工 E2E + 构建 | `QueryPage.test` 覆盖默认空态 / URL 自动执行 / 取消 / 错误 / 辅助选择 / 快捷范围；`queryRange.test` / `chartOption.test` / `TimeSeriesChart.test` 覆盖 step、断点、0、option、生命周期；页面无网域选择器，元信息展示 `meta.network_domains`。深链入口（目标状态/指标库/告警）与查询历史未接线 | partial |

---

## 2. 非功能验收（NFR）

| NFR | 需求 | 实现任务 | 验证方式 | 证据 | 状态 |
|---|---|---|---|---|---|
| NFR-01 | 中心不直接 scrape/probe | T09-B5-1 / V1-2 | 代码审查：无中心发起采集；仅节点执行 | 配置生成仅读取 M07 资源并渲染，无中心 scrape/probe 代码；最终审查待 V1-2 | partial |
| NFR-02 | 无 management/local/default；统一 agent_pull；中心网域也部署节点 | T09-B1-1 / B3-1 | grep + 迁移约束：契约无 local/management；不 seed default | 迁移侧已验证：00005 不含 management/local/default 分支；契约快照无 local/management 路由；B3 服务层不 seed default，纳管仅接受 enabled+edge（ValidateMonitorable），无 management/local 分支 | partial |
| NFR-03 | 中心不入站连接节点；指令心跳拉取 | T09-B4-1 / V1-2 | 安全审查：edge 组仅被动响应 | edge 组仅提供 heartbeat/config 被动响应，指令经心跳响应下发；无中心主动连接节点代码。安全审查待 V1-2 | partial |
| NFR-04 | 配置生成/校验/切换原子幂等；失败不覆盖 | T09-B5-2 | 单测：并发 per-domain 锁；失败保留 current | per-domain 互斥锁；校验通过才在事务内切换 is_current（先降旧再升新）；失败仅写 failed 快照；checksum 未变跳过 | partial |
| NFR-05 | 历史只读，禁止接口恢复 | T09-B5-3 | grep：无 rollback/restore 端点 | 路由扫描单测断言无 confirm/rollback/restore/revalidate/discard/deployments；仅提供 GET 只读端点 | done |
| NFR-06 | 心跳 7 天保留清理；快照随删除/退纳管/域删同步清理 | T09-B4-2 | 单测：清理 worker；级联清理 | CleanupHeartbeats(7d) 与退纳管级联清 target/config 快照单测通过；bootstrap 维护循环已接线（1 分钟） | done |
| NFR-07 | Token 高强度随机；仅存 SHA-256 哈希；接口/日志不返回明文；重置废止立即生效 | T09-B3-2 / V1-2 | 单测 + grep 日志：仅哈希存储；明文仅一次 | crypto/rand 32B hex（256 bit）+ sha256 存储（D39）；明文仅签发/重置响应；列表/详情无 token 字段；重置覆盖 hash（旧 Token 立即失效）；代码审计确认日志无明文，V1-2 日志全量复测待执行 | partial |
| NFR-08 | 查询与目标按网域隔离：服务端按当前租户解析授权网域集，注入 `network_domain` 标签约束；不注入 `tenant`；越权不可见 | T09-B6-1 / B6-2 / V1-1 | e2e：跨域数据不可见；断言未注入 tenant 匹配器 | targets/coverage/PromQL 全部按租户授权域过滤；注入 `network_domain_id`（D33）；tenant-a 越权域不可见；单测覆盖。跨域 e2e 待 V1-1 | partial |
| NFR-09 | 配置产物内容保护：预览/下载仅管理员；接口与日志不输出内容明文 | T09-B5-3 / B7 | 单测：非 admin 403；日志脱敏审查 | 产物预览/导出/恢复包仅 admin（artifact_handler 403）；内容写入不打印明文；导出件按需读取 | done |
| NFR-10 | 查询代理 P95 附加开销 ≤50ms；targets 禁止逐行查时序 | T09-B6-2 / V1-3 | 手工压测归档（未达标 open）；代码审查无逐行查询 | 代码审查：代理为单次转发 + 常量级字符串注入；targets/coverage 为集合 SQL，无逐行时序查询。P95 压测待 V1-3 | partial |
| NFR-11 | 查询规模与护栏：范围/点数/超时/长度上限，超限给可执行提示 | 本次增量 | 单测：边界值、护栏不触达上游、400 映射 | `query_guard_test` 覆盖 30d / 15s / 11000 点 / 8 KiB / duration 解析；`query_service_test` 断言护栏命中不请求上游；`query_handler_test` 断言 400 `bad_request`；超时标记 `UpstreamError.Timeout` → 502 | done |
| NFR-12 | 查询页性能：1000 点 × 20 序列 1 秒级；路由懒加载；重复查询/缩放不卡顿 | 本次增量 | 构建产物 + 手工压测 | ECharts 6 按需注册、`sampling='lttb'`、`dataZoom`；QueryPage 路由懒加载（生产 chunk 约 192 KB gzip）；1000×20 首屏压测待补 | partial |
| NFR-13 | 用户语言一致性与错误可执行 | 本次增量 / V1-2 | 文案审查 + 错误提示 | 查询页使用「网域 / 指标查询 / 覆盖网域」等业务语言，无网域选择器；`bad_data`、超限、上游超时/不可达均给下一步建议；全站文案检查待 V1-2 | partial |

---

## 3. 工程门禁

| 项 | 标准 | 验证命令 | 状态 |
|---|---|---|---|
| 单元测试 | m09 各层 + agent 有 `*_test.go` | `go test ./platform/modules/m09/...`、`cd platform/edge-sync-agent && go test ./...` | m09 domain/service/handler/configgen/references 单测通过（B2–B6：Token/纳管/心跳/节点指令/快照/查询注入/三态）；查询护栏 `query_guard_test` / 多网域授权 / 超时；前端 `pnpm vitest run src/pages/query src/api/query.test.ts src/api/client.test.ts` 65 用例通过；agent 侧待 A 线 | partial |
| vet | 全平台无告警 | `go vet ./platform/...` | B2: `go vet ./platform/modules/m09/... ./platform/cmd/metric-center/...` 无告警；全平台 `./platform/...` 待 V1 | partial |
| 迁移 | 00005 Up/Down 各 2 次、FK/索引/约束 | `go test ./platform/db/...` + migrate CLI | B1 已验证（见 task-sequence T09-B1-1 evidence） | done |
| 契约 | golden 字段集回归；严格 JSON | `go test ./platform/modules/m09/...` | B3/B4 DTO 落地；写接口 DisallowUnknownFields（monitor/heartbeat 单测覆盖）；golden 字段集全量回归待 V1 | partial |
| 端到端 | v3-only 主链路 | `go test ./platform/cmd/metric-center/...` | B2–B6: meta 含 m09；鉴权链 401/403；心跳与节点指令；快照/edge config；targets/coverage/PromQL 代理与 meta | partial |
| 安全审查 | 无 Critical/High 未闭环 | security-reviewer | todo |
| PostgreSQL | 00005 PG 迁移（执行器修复后） | `METRIC_CENTER_TEST_POSTGRES_DSN` 门控 | open（环境） |
| 性能 | NFR-10 P95 | 手工测量归档 | open |

---

## 4. 本次范围外（登记 open，不阻塞 M09 v3 验收）

- 指标查询页深链入口（目标状态/告警/指标库）与查询历史（P1）；URL 契约已就绪，本次未接线。
- M01 v3 源数据端口的最终实现（当前适配 legacy models，M01 v3 落地后替换）。
- PostgreSQL 迁移实测（依赖执行器 `?` 占位符修复）。
- NFR-10 P95 性能实测、NFR-12 1000×20 首屏压测与 NFR-13 全站文案检查。
- v2 legacy 包的最终删除（兼容窗口结束后统一清理，D10）。

---

## 5. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-11-11 | 初稿：FR-01~21 / NFR-01~11 逐条映射到任务与验证方式 |
| v0.2 | 2026-11-12 | B2 回填：工程门禁（单元测试 / vet / 迁移 / 端到端）状态与证据；登记 D32 路由冲突（m06 让出网域读端点，B3 实施） |
| v0.3 | 2026-11-11 | B3 回填：FR-01/02 完成，FR-03/04 partial；NFR-02/07/11 partial；D32 已落地（m06 让出网域读端点，m09 enriched 视图承载） |
| v0.4 | 2026-11-11 | B4 回填：FR-05/08 done，FR-06/07/09 partial；NFR-03/06 partial；心跳协议与边缘 Token 真实校验落地 |
| v0.5 | 2026-11-12 | B5 回填：FR-13 done，FR-10/11/12/14 partial；NFR-05 done，NFR-01/04 partial；configgen/快照原子切换/历史保留/只读端点/edge config 拉取落地 |
| v0.6 | 2026-11-12 | B6 回填：FR-16/17/18/19/20 done，FR-15 partial（中心 targets 融合待增量）；NFR-08/09 partial；查询代理注入标签名按 D33 记为 network_domain_id |
| v0.7 | 2026-11-12 | B7 回填：FR-21 done、FR-03 done（离线包 sha256/ETag）；D33 owner 授权后 SRS 升至 v1.2、契约用词统一为 network_domain_id |
| v0.8 | 2026-11-12 | 后台调度收口：M09 维护循环（离线检测/心跳保留）与配置 watcher（立即首轮 + 30s）接入 v3 bootstrap；FR-06 / NFR-06 done |
| v0.9 | 2026-11-12 | A1-2 完成：agent 切换 /api/v3/edge/* + protocol_version v1 + If-None-Match；服务端 edge config 返回 zip；心跳回填 config_changed/下载地址；FR-11 done。A1-1 主循环拆包待执行 |
| v1.0 | 2026-11-12 | A1-1 完成：agent 主循环迁入 internal/app（接口注入、context 驱动、可单测）；cmd 仅装配与信号处理 |
| v1.1 | 2026-11-18 | 标签模板消费闭环：source_reader 读取 `m07_label_templates`，按「Job 显式 → 类别默认 → 仅 system」展开 target labels；system `resource_id` 受保护；`platform_code` 空值按应用主平台兜底；模板变更纳入 Fingerprint。详见 M07 `label-templates-execution.md` §5.3 |
| v1.2 | 2026-11-22 | 指标查询增量：FR-22 前端查询页（区间查询 / ECharts 断点图 / 时间范围 / 取消 / URL / 预设 / 指标名-Job-实例辅助选择）落地，深链与查询历史标 partial；NFR-11 查询护栏 done（8 KiB / 30d / 15s / 11000 点 / 30s），NFR-12/13 partial。页面不含网域选择器，服务端按授权网域自动过滤。详见 `metric-query-execution.md` |
