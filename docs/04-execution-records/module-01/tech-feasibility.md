# Module_01 blackbox 拨测与 Module_09 配置生成技术可行性报告

> **报告状态**：预研完成（基于源码走读 + 官方文档 + 配置样例，未做完整运行时验证）  
> **对应 PRD**：`docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v1.1）、`Module_09_Network_Domain_and_Edge_Config_Center.md`（v1.2）  
> **关联设计决策**：`docs/04-execution-records/module-01/design-decisions.md` 决策 4、7  
> **更新日期**：2026-08-04

---

## 1. 待验证问题

本次预研聚焦 2026-08-04 需求对齐后产生的 blackbox 拨测与配置生成技术细节，需回答以下问题：

| 编号 | 问题 | 关联模块 |
|---|---|---|
| Q1 | blackbox 拨测能否以标准 Prometheus scrape job 形态存在（`metrics_path=/probe` + `relabel_configs`），多模块是否可共享一个 blackbox exporter 实例？ | Module_01 / Module_09 |
| Q2 | 边缘采集器 `vmagent` / `prometheus-agent` 是否原生支持 blackbox 探测配置，是否仍需部署 blackbox exporter？ | Module_09 |
| Q3 | Prometheus 配置变更后能否热加载 scrape_configs / rules，且配置非法时能否保持原配置不中断采集？ | Module_09 |
| Q4 | 按 `network_domain_id` 生成独立 `prometheus.yml` 并在 `global.external_labels` 注入 `network_domain`、`tenant_id`，能否保证指标来源隔离？ | Module_09 |
| Q5 | blackbox 探测目标在数据模型上应作为 `ScrapeJob` 的内嵌目标，还是独立 `BlackboxTarget` 对象？ | Module_01 |
| Q6 | ICMP 等探测在政府/专网离线部署中的权限与交付约束是什么？ | Module_09 |
| Q7 | `Module_09` 下发的配置包应包含哪些文件，`prometheus.yml` 与 `blackbox.yml` 如何联动？ | Module_09 |

---

## 2. 涉及的开源组件

| 组件 | 版本/来源 | 作用 |
|---|---|---|
| Prometheus | 本地 `upstream/prometheus`（VERSION: 3.13.0） | 中心采集/存储，配置 schema 与 reload 行为来源 |
| Blackbox Exporter | `prom/blackbox-exporter`（latest / 0.25.0） | HTTP/TCP/ICMP/DNS 探测执行器 |
| vmagent | VictoriaMetrics | 边缘轻量采集器，支持 Prometheus scrape_configs |
| prometheus-agent | Prometheus Agent Mode | 边缘替代采集器，仅 scrape + remote_write |
| promtool | Prometheus 官方 CLI | 配置语法校验 |
| Docker / Docker Compose | 本地环境 | 用于运行时验证（本机 Docker 未运行，未实际执行） |

---

## 3. 验证方法

1. **配置样例编写**：在 `/tmp/metriccenter-blackbox-test/` 编写 `blackbox.yml`、`prometheus.yml`、`docker-compose.yml`，覆盖 HTTP/TCP/ICMP/DNS 模块与多目标 exporter 模式。
2. **源码走读**：
   - `upstream/prometheus/config/config.go`：确认 `ScrapeConfig` 支持 `MetricsPath`、`Params`、`RelabelConfigs`。
   - `upstream/prometheus/model/relabel/relabel.go`：确认 relabel 动作语法。
   - `upstream/prometheus/scrape/manager.go`：确认 `ApplyConfig` / `reload` 的 pool 更新逻辑。
3. **官方文档复核**：Prometheus 官方 multi-target exporter 指南、blackbox exporter 配置说明、vmagent 文档。
4. **运行时验证尝试**：
   - 尝试 Docker Compose 启动，本机 Docker daemon 未运行，无法完成。
   - 尝试 `go run ./cmd/promtool check config` 校验配置，因依赖拉取/编译耗时过长未得到结果。
   - 实际结论依赖源码与官方文档推导。

---

## 4. 验证结果

### 4.1 Prometheus + Blackbox Exporter 标准集成（Q1）

**结论：可行，且是 Prometheus 官方推荐的多目标 exporter 模式。**

Blackbox Exporter 本身不维护目标列表，而是根据 Prometheus 每次 `GET /probe?module=<module>&target=<target>` 请求执行探测。配置要点：

- `scrape_configs` 中 `metrics_path` 必须为 `/probe`。
- 通过 `params.module` 引用 `blackbox.yml` 中定义的模块名。
- 通过 `relabel_configs` 将 `__address__` 注入为 `__param_target`，并把 `__address__` 改写到 blackbox exporter 地址。

示例（验证样例 `/tmp/metriccenter-blackbox-test/prometheus.yml`）：

```yaml
scrape_configs:
  - job_name: 'blackbox-http'
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
        - https://httpbin.org/get
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox:9115
```

`blackbox.yml` 中可定义多个模块（`http_2xx`、`tcp_connect`、`icmp_ping`、`dns_query` 等），同一 blackbox exporter 实例可被多个 scrape job 复用，仅通过 `params.module` 区分。

**关键证据**：
- Prometheus `config.go` 中 `ScrapeConfig` 字段完整支持 `MetricsPath`、`Params`、`RelabelConfigs`。
- `model/relabel/relabel.go` 支持 `replace` 动作与 `__param_*` 元标签，用于向 exporter 传参。
- 官方文档《Understanding and using the multi-target exporter pattern》明确说明该模式。

### 4.2 vmagent / prometheus-agent 对 blackbox 配置的兼容性（Q2）

**结论：两者均兼容标准的 `scrape_configs`，但都不能替代 blackbox exporter 执行探测，必须额外部署 blackbox exporter。**

- **vmagent**：可读取 Prometheus 格式配置文件，`scrape_configs` 完全兼容；对 `alerting`、`rule_files`、`remote_read` 等 section 不支持，需通过 `-promscrape.config.strictParse=false` 忽略。
- **prometheus-agent**：与 Prometheus 共享 scrape/discovery 实现，`scrape_configs` 可直接复用；Agent Mode 禁止 `alerting`、`rule_files`、`remote_read` 字段。

因此，边缘网域若使用 blackbox 拨测，Edge Sync Agent 启动的容器/进程组应包含：

1. `vmagent` 或 `prometheus-agent`（采集 + remote_write）
2. `blackbox_exporter`（探测执行器，监听 9115）

`prometheus.yml` 中 `__address__` 应替换为本地 blackbox exporter 地址（如 `127.0.0.1:9115` 或容器服务名）。

### 4.3 配置 reload 与原配置回退行为（Q3）

**结论：Prometheus 支持热加载；非法配置会被拒绝，原配置继续生效。**

- 触发方式：
  - `kill -HUP <pid>`
  - `POST /-/reload`（需启动参数 `--web.enable-lifecycle`）
- 源码层面：`scrape/manager.go` 的 `ApplyConfig` 会先调用 `cfg.GetScrapeConfigs()` 解析配置，失败直接返回错误；成功后再对比旧 pool，按 job 增量更新或重建 scrape pool。非法 YAML/校验失败不会进入 pool 更新阶段。
- 官方文档说明：*If the new configuration is not well-formed, the changes will not be applied.*

对 Module_09 的启示：
- 下发前可先用 `promtool check config` 校验。
- 调用 `/api/v1/health` 与 `/api/v1/status` 确认 reload 后服务正常。
- 下发记录需捕获 reload 返回值，失败时保持 `ConfigVersion` 不变。

### 4.4 多网域隔离与 external_labels 注入（Q4）

**结论：在 `global.external_labels` 中注入 `network_domain` 与 `tenant_id` 是 Prometheus/vmagent 原生支持的全局标签机制，可实现指标来源隔离。**

- `config.go` 的 `Load` 会解析 `global.external_labels`；scrape 后 external labels 会被附加到每条时间序列。
- vmagent 同样会在 remote_write 时将 external labels 发送至中心存储。
- Module_09 生成的每个网域配置应独立写入：

```yaml
global:
  external_labels:
    network_domain: "gov-cloud-a"
    tenant_id: "tenant-a"
```

该机制是 Module_02 按网域查询与租户隔离的数据基础。

### 4.5 blackbox 目标数据模型归属（Q5）

**结论：建议 blackbox 拨测目标内嵌到 `ScrapeJob` 中，不再维护独立 `BlackboxTarget` 实体。**

依据：
- 设计决策 4 已明确将拨测配置合并为 `ScrapeJob` 的 `job_type=blackbox`。
- Prometheus 中 blackbox 探测本质就是一个 scrape job，目标字段为字符串（URL / IP / 域名），无需复用 `Resource` 的 `instance_ip` 等字段。
- 若独立维护 `BlackboxTarget`，则 `Module_09` 生成配置时需额外合并逻辑，且难以与标准 job 统一处理（interval、timeout、enabled、network_domain_id 等字段已存在于 `ScrapeJob`）。

建议扩展的 `ScrapeJob` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `job_type` | enum | `standard` / `blackbox` |
| `blackbox_module` | string | 对应 `blackbox.yml` 模块名，如 `http_2xx` |
| `blackbox_targets` | []string | 探测目标字符串，如 `https://api.example.com/health`、`10.0.1.11` |

`selected_instance_ids` 在 blackbox job 中可置空或复用为 `blackbox_targets` 的扁平存储。

### 4.6 ICMP 探测权限与交付约束（Q6）

**结论：ICMP 探测需要进程具备创建 raw socket 的权限。**

- 二进制部署：blackbox exporter 需以 root 运行，或赋予 `CAP_NET_RAW` capability（`setcap cap_net_raw+ep ./blackbox_exporter`）。
- 容器部署：需在 security context 中声明 `CAP_NET_RAW`。
- 政府/专网离线交付时，安装包/systemd 单元中需显式说明权限授予方式，避免默认启动后 ICMP 探测失败。
- 如客户安全策略禁止 raw socket，可降级为 TCP 端口探测或 HTTP 探测。

### 4.7 配置包内容与联动方式（Q7）

**结论：Module_09 下发的配置包应包含 `prometheus.yml`、`blackbox.yml`（按需）、`rules.yml`（v0.4+）、`metadata.json`。**

生成逻辑：
1. 按 `network_domain_id` 聚合 `ScrapeJob`。
2. 标准 job：根据 `selected_instance_ids` 与 `LabelTemplate` 生成 `static_configs` targets 和 labels。
3. blackbox job：生成 `metrics_path=/probe` 的 scrape_config，并在同域 `blackbox.yml` 中写入该 job 引用的模块。
4. `prometheus.yml` 中所有 scrape_config 的 `__address__` 重写为本地 blackbox exporter 地址（如 `127.0.0.1:9115`）。
5. 注入 `global.external_labels.network_domain` 与 `tenant_id`。
6. 计算 checksum，写入 `metadata.json`。

Edge Sync Agent 本地行为：
1. 拉取 zip 包并校验 checksum。
2. 解压覆盖本地配置文件。
3. 调用采集器 `/api/v1/config/reload`（vmagent 支持）或 `/-/reload`（Prometheus Agent）。
4. blackbox exporter 重启或收到 SIGHUP 后重新加载 `blackbox.yml`。

---

## 5. 方案对比

### 方案 A：blackbox exporter 与采集器同域部署（推荐）

**描述**：每个网域（含中心 `default` 网域）独立部署一个 blackbox exporter 实例，Module_09 下发的配置包同时包含 `prometheus.yml` 与 `blackbox.yml`。

**优点**：
- 符合 Prometheus 官方多目标 exporter 模式，生态成熟。
- 探测源点与采集器位于同一网域，真实反映该网域对目标的可达性。
- 不引入跨网域探测流量，适配政务网/专网隔离要求。
- `vmagent` / `prometheus-agent` 均无需修改，直接复用标准 `scrape_configs`。
- 模块复用率高，一个 blackbox exporter 实例即可服务多个 blackbox job。

**缺点**：
- 每个网域需额外部署一个 blackbox exporter 二进制/容器。
- ICMP 探测需要 `CAP_NET_RAW` 或 root 权限，离线安装包需显式配置。
- Edge Sync Agent 启动脚本需负责拉起 blackbox exporter。

### 方案 B：中心 blackbox exporter 远程探测

**描述**：所有网域的 scrape_config 将 `__address__` 指向中心 blackbox exporter 服务，Module_09 不下发 `blackbox.yml`。

**优点**：
- 边缘无需部署 blackbox exporter，减少组件数量。
- 模块更新只需修改中心一份配置。

**缺点**：
- 探测流量需从中心穿越到目标网域，政务网/专网通常禁止此类回环流量。
- 无法反映边缘网络视角（探测路径与真实用户路径不一致）。
- 中心 blackbox exporter 成为单点，且目标地址必须对中心可达。
- 与 Module_09 “边缘 Agent 本地采集 + remote write 回传” 的架构原则冲突。
- 多网域隔离仅依赖 `external_labels`，一旦路由配置错误易导致数据混淆。

**结论**：方案 A 与产品架构（多网域隔离、边缘采集、离线部署）更匹配，建议采用方案 A。

---

## 6. 结论

1. **技术可行**：blackbox 拨测完全可以通过标准 Prometheus scrape job + relabel 实现，并可被 `vmagent` / `prometheus-agent` 复用。
2. **推荐方案**：按网域同域部署 blackbox exporter，Module_09 同时生成并下发 `prometheus.yml` 与 `blackbox.yml`。
3. **数据模型**：blackbox 目标应内嵌到 `ScrapeJob`（`job_type=blackbox`），不再维护独立拨测实体。
4. **配置隔离**：通过 `global.external_labels.network_domain` / `tenant_id` 实现指标来源隔离，已被 Prometheus/vmagent 原生支持。
5. **reload 安全**：Prometheus 配置热加载失败时会保留原配置，Module_09 下发前应使用 `promtool check config` 做预校验。
6. **部署注意**：ICMP 探测需 `CAP_NET_RAW`；边缘交付物需包含 blackbox exporter 二进制/容器与 systemd 启动单元。
7. **验证缺口**：本次未能在本机完成 Docker 与 promtool 的实际运行验证，后续在具备环境后应补充端到端测试。

---

## 7. 对 PRD 的建议修改

### 7.1 Module_01 PRD 建议

1. **在 5.4 `ScrapeJob` 数据模型中新增字段**：
   - `job_type`：enum，`standard` / `blackbox`，默认 `standard`。
   - `blackbox_module`：string，仅 `job_type=blackbox` 时必填，引用 blackbox 模块名。
   - `blackbox_targets`：[]string，仅 `job_type=blackbox` 时必填。
2. **3.1 核心功能表**：将“拨测配置管理”条目移除或改为“ScrapeJob blackbox 类型支持”。
3. **5.3 ExporterMetricLibrary**：MVP 必须内置 blackbox exporter 的指标定义，至少包含 `probe_success`、`probe_duration_seconds`、`probe_http_status_code` 等。
4. **5.6 ExporterInstallationConfirmation**：说明该确认仅针对标准 Exporter；blackbox job 不涉及目标实例安装确认，但边缘 blackbox exporter 实例的健康状态由 Module_09 EdgeAgent 维护。
5. **原型调整**：`docs/prototypes/module-01/src/pages/ProbesPage.tsx` 与 `ScrapeJobsPage.tsx` 建议合并为“采集 Job”页面中的 blackbox 类型视图，避免独立入口导致与标准 job 重复。

### 7.2 Module_09 PRD 建议

1. **4.4 ConfigDraft / 4.5 ConfigVersion**：
   - 已包含 `blackbox_yml` 字段，建议在 3.3 / 3.5 中明确：当网域存在 `job_type=blackbox` 的 ScrapeJob 时，必须生成并打包 `blackbox.yml`。
2. **3.5 配置包结构**：
   - 明确 `prometheus.yml` 中 blackbox job 的 `__address__` 替换为本地 blackbox exporter 地址（如 `127.0.0.1:9115`）。
   - 明确边缘 `prometheus.yml` 不应包含 `alerting`、`rule_files`、`remote_read`（prometheus-agent 限制）；如使用 vmagent，建议加 `-promscrape.config.strictParse=false`。
3. **3.3.1 external_labels 注入**：
   - 建议补充：注入标签名为 `network_domain` 与 `tenant_id`，值分别取自 `NetworkDomain.id` 与 `NetworkDomain.tenant_id`。
4. **3.5 下发流程**：
   - 增加“下发前校验”步骤：调用 `promtool check config` 校验 `prometheus.yml`，调用 blackbox exporter `--config.check` 校验 `blackbox.yml`。
   - 增加 blackbox exporter 重启/重载说明：配置文件更新后，Edge Sync Agent 需触发 blackbox exporter 重载。
5. **3.9 交付方式**：
   - 在“离线二进制包 + systemd”交付方式中补充 blackbox exporter 二进制、capability 设置示例与 systemd 启动依赖。

### 7.3 跨 PRD 一致性建议

1. **网域归属约束**：所有 ScrapeJob（含 blackbox）必须绑定单一 `network_domain_id`，禁止跨网域共享目标。
2. **变更触发**：blackbox ScrapeJob 的 CRUD、启停、模块变更均需触发 Module_09 重新生成对应网域的 `ConfigDraft`（与设计决策 7 保持一致）。
3. **指标库联动**：blackbox 相关告警规则（如 `probe_success == 0`）使用的指标必须先在 Module_01 指标库中注册。

---

## 8. 附录：验证样例

### 8.1 `/tmp/metriccenter-blackbox-test/blackbox.yml`

```yaml
modules:
  http_2xx:
    prober: http
    timeout: 10s
    http:
      valid_http_versions: ["HTTP/1.1", "HTTP/2.0"]
      valid_status_codes: []
      method: GET
      follow_redirects: true
      preferred_ip_protocol: "ip4"
      ip_protocol_fallback: true
  tcp_connect:
    prober: tcp
    timeout: 5s
  icmp_ping:
    prober: icmp
    timeout: 5s
    icmp:
      preferred_ip_protocol: "ip4"
  dns_query:
    prober: dns
    timeout: 5s
    dns:
      query_name: "example.com"
      query_type: "A"
      valid_rcodes: ["NOERROR"]
```

### 8.2 `/tmp/metriccenter-blackbox-test/prometheus.yml`

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    network_domain: "default"
    tenant_id: "platform_admin"

scrape_configs:
  - job_name: 'blackbox-http'
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
        - https://httpbin.org/get
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox:9115

  - job_name: 'blackbox-dns'
    metrics_path: /probe
    params:
      module: [dns_query]
    static_configs:
      - targets:
        - 1.1.1.1
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox:9115
```

### 8.3 关键源码引用

- `upstream/prometheus/config/config.go`：`ScrapeConfig` 字段定义（MetricsPath、Params、RelabelConfigs）。
- `upstream/prometheus/model/relabel/relabel.go`：`Config` 结构体与 relabel 动作校验。
- `upstream/prometheus/scrape/manager.go`：`ApplyConfig` 与 `reload` 方法，确认 pool 级热更新逻辑。

---

## 9. 参考来源

- [Prometheus Configuration - Reload](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- [Prometheus Management API - Reload](https://prometheus.io/docs/prometheus/latest/management_api/)
- [Prometheus Multi-target Exporter Guide](https://prometheus.io/docs/guides/multi-target-exporter/)
- [Blackbox Exporter Configuration](https://github.com/prometheus/blackbox_exporter/blob/master/CONFIGURATION.md)
- [VictoriaMetrics vmagent Documentation](https://docs.victoriametrics.com/vmagent.html)
- [VictoriaMetrics VMProbe CRD](https://docs.victoriametrics.com/operator/resources/vmprobe/)
- [Prometheus Agent Mode](https://prometheus.io/docs/prometheus/latest/prometheus_agent/)
