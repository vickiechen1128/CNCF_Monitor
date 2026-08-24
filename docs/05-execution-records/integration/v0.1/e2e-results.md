# integration/v0.1：端到端验证结果

## 验证环境

| 项 | 值 |
|----|----|
| 分支 | `integration/v0.1` |
| 提交 | `<commit-hash>` |
| 验证日期 | 2026-08-XX |
| 验证人 |  |
| 运行方式 | `make run-metric-center` + `make run-prometheus` + `make dev-ui` |

## 验证用例与结果

### 用例 1：基础管理链路

| 步骤 | 操作 | 期望结果 | 实际结果 | 状态 |
|------|------|----------|----------|------|
| 1 | 网域登记 | `default` 已纳管 |  |  |
| 2 | 资源导入 | 资源列表展示正确 |  |  |
| 3 | 创建 ScrapeJob | Job 状态正确 |  |  |
| 4 | 配置生成/确认下发 | ConfigVersion 生成，reload 成功 |  |  |
| 5 | 首页 Dashboard | 数据真实 |  |  |

### 用例 2：blackbox 拨测链路

| 步骤 | 操作 | 期望结果 | 实际结果 | 状态 |
|------|------|----------|----------|------|
| 1 | 创建 blackbox ScrapeJob | `blackbox.yml` 生成 |  |  |
| 2 | 确认下发 | blackbox exporter 重载成功 |  |  |
| 3 | 查询指标 | 拨测指标可见 |  |  |

## 结论

- [ ] 全部通过
- [ ] 存在遗留问题（见 `issues.md`）
- [ ] 未通过，需重新联调
