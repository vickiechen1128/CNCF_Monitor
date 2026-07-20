# Prometheus 架构知识

## 核心模块

| 模块 | 关键文件 | 职责 |
|------|----------|------|
| 入口 | `cmd/prometheus/main.go` | 启动流程 |
| 配置 | `config/config.go` | YAML 配置解析 |
| 服务发现 | `discovery/discovery.go` | Discoverer 接口 |
| 采集 | `scrape/manager.go` | 抓取管理 |
| 存储 | `storage/interface.go` | 存储抽象 |
| TSDB | `tsdb/db.go` | 时序数据库 |
| 查询 | `promql/engine.go` | PromQL 引擎 |
| 规则 | `rules/manager.go` | 规则引擎 |
| 通知 | `notifier/manager.go` | 告警通知 |

## 扩展点

| 扩展点 | 接口 | 适用场景 |
|--------|------|----------|
| 服务发现 | `discovery.Discoverer` | 自定义目标发现 |
| 远程写入 | `storage.Appendable` | 数据转发 |
| 远程读取 | `storage.Queryable` | 外部存储查询 |

## 关键接口

```go
type Discoverer interface {
    Run(ctx context.Context, up chan<- []*targetgroup.Group)
}
```

## 数据流

```
发现源 → Discovery Manager → Scrape Manager → scrapeLoop → TSDB → Query/Rule
```

## 最佳实践

- 优先使用扩展点，其次独立组件，最后 patch 源码
- 不修改 `tsdb/` 和 `promql/engine.go` 等核心区域
- 所有 patch 必须记录说明
