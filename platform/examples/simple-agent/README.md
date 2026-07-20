# Simple Agent 模板

MetricCenter 采集端 Agent 模板，基于 `prometheus/client_golang` 实现，演示如何暴露 `/metrics` 端点供 Prometheus 抓取。

## 用途

- 作为自定义 Exporter 的开发起点
- 与 MetricCenter Module 07「采集模板」配合，一键生成 scrape_config
- 验证「CMDB 字段 → Prometheus Label → 配置下发」的完整链路

## 快速开始

```bash
cd platform/examples/simple-agent

# 下载依赖
go mod tidy

# 启动 Agent
go run main.go -listen-address ":9100" -app-name "order-service" -env "prod"
```

访问测试：

```bash
# 健康检查
curl http://localhost:9100/health

# 查看指标
curl http://localhost:9100/metrics
```

## 命令行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-listen-address` | `:9100` | Agent 监听地址 |
| `-app-name` | `demo-app` | 应用名，映射为 `app` label |
| `-app-group` | `demo-group` | 应用分组，映射为 `app_group` label |
| `-env` | `dev` | 环境名，映射为 `env` label |
| `-cluster` | `default` | 集群名，映射为 `cluster` label |

## 暴露的指标

| 指标名 | 类型 | 说明 |
|--------|------|------|
| `demo_http_requests_total` | Counter | HTTP 请求总数，按 method/status 分组 |
| `demo_active_connections` | Gauge | 当前活跃连接数 |
| `demo_http_request_duration_seconds` | Histogram | HTTP 请求处理耗时 |

## 在 MetricCenter 中注册

启动 Agent 后，在 MetricCenter 中创建如下 ScrapeJob：

```yaml
job_name: 'simple-agent-demo'
scrape_interval: 15s
static_configs:
  - targets:
      - 'localhost:9100'
    labels:
      app: 'order-service'
      app_group: '电商中台'
      env: 'prod'
      cluster: 'bj-01'
```

> 实际生产环境中，target 列表应由 CMDB 资源动态生成，标签由标签模板映射，无需在 scrape_config 中硬编码。

## 扩展建议

1. 将 `simulateMetrics()` 替换为真实业务埋点
2. 新增业务专属指标时，参考 `prometheus.NewCounterVec` / `NewGauge` / `NewHistogramVec` 模式
3. 如需 Push 模式，可考虑 Pushgateway；MetricCenter 推荐优先使用 Pull 模式
