# MetricCenter 测试标准

> 文档类型：工程标准
> 目标：建立后端与前端的测试规范，确保改造后的 Prometheus 稳定可靠。
> 更新日期：2026-07-16

---

## 1. 后端测试

### 1.1 单元测试

- 所有 `platform/` 下的业务包必须包含 `*_test.go`
- 使用标准 `testing` 包 + `testify/assert`
- 外部依赖使用 mock 或接口注入

### 1.2 集成测试

- 使用 `testcontainers-go` 或本地 Docker 启动依赖服务
- 覆盖关键路径：发现源同步、查询代理、认证鉴权

### 1.3 Prometheus 原有测试

- 不修改 `upstream/prometheus/` 原有测试
- 如果 patch 影响了 upstream 测试，需要在 patch 说明中标注

---

## 2. 前端测试

### 2.1 单元测试

- 使用 Vitest + React Testing Library
- 组件测试聚焦用户交互和渲染结果

### 2.2 E2E 测试

- 使用 Playwright
- 覆盖：登录、查询、目标管理核心流程

---

## 3. 测试覆盖率

| 模块 | 目标覆盖率 |
|------|-----------|
| platform/gateway | ≥ 70% |
| platform/discovery | ≥ 70% |
| platform/collector | ≥ 60% |
| ui-custom/web | ≥ 50% |

---

## 4. CI 检查

提交代码前必须：

- [ ] 通过 `go test ./platform/...`
- [ ] 通过 `go vet ./platform/...`
- [ ] 前端通过 `pnpm test`
- [ ] 前端通过 `pnpm lint`
