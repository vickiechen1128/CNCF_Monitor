# MetricCenter 测试标准

> 文档类型：工程标准
> **目标读者**：后端开发工程师、前端开发工程师（编码前必读）、技术架构师（质量门禁 / 覆盖率评估）
> 目标：建立后端与前端的测试规范，确保改造后的 Prometheus 稳定可靠。
> **权威定位（v1.25）**：本文档 §4「提交前验证清单」为测试 / lint / 服务启动验证的**唯一权威**，其他标准（01 §5、02 §6）只做引用。
> 更新日期：2026-08-22（v1.26 新增前端单文件测试粒度与 flaky 处理原则）

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

### 2.3 Flaky 测试处理原则（v2026-08-22 新增）

- **禁止把 flaky 测试制度化**：不允许以「重试 2 次即算通过」作为常规验收标准。
- 发现 flaky 后优先修复根因：
  - 使用 `await screen.findBy*` / `waitFor` 处理异步渲染；
  - 使用 `userEvent.setup()` 而非 `userEvent.click` 旧用法；
  - 对 antd `Modal`、`Select`、`Drawer` 等 jsdom 不稳定组件，统一使用 `src/test/antdTestUtils.tsx` 提供的 helper；
  - mock `matchMedia`、`getComputedStyle`、`scrollTo`、`ResizeObserver` 等 jsdom 缺失 API。
- 对暂时无法根除的 flaky 用例，必须：
  - 隔离到独立文件（如 `*.flaky.test.tsx`）或在用例顶部加显式注释 `// FLAKY: root cause & tracking issue`；
  - 在执行记录中标注为技术债务，限期修复；
  - 不得以普通用例身份进入全量回归。
- 禁止每个测试文件自行发明临时 workaround。所有 antd 组件测试稳定模式统一沉淀在 `web-development` skill 与 `src/test/antdTestUtils.tsx`。

---

## 3. 测试覆盖率

| 模块 | 目标覆盖率 |
|------|-----------|
| platform/gateway | ≥ 70% |
| platform/discovery | ≥ 70% |
| platform/collector | ≥ 60% |
| ui-custom/web | ≥ 50% |

---

## 4. 提交前验证清单

提交代码前必须完成以下检查：

### 4.1 静态检查

- [ ] 通过 `go test ./platform/...`
- [ ] 通过 `go vet ./platform/...`
- [ ] 前端通过 `pnpm lint`
- [ ] 前端单任务验证通过 `pnpm vitest run <具体测试文件>`（开发期每个任务必须）
- [ ] 前端全量回归通过 `pnpm test`（仅在 Phase 收尾、合并前、CI 中执行）

### 4.2 服务启动验证

- [ ] 后端服务能正常启动，且关键接口返回 200
  ```bash
  GOPROXY=off go run ./platform/cmd/metric-center/main.go
  curl -s http://localhost:8080/api/v1/health
  curl -s http://localhost:8080/api/v1/health/db
  curl -s http://localhost:8080/api/v1/status
  ```
- [ ] 前端 dev server 能正常启动，且首页返回 200
  ```bash
  cd ui-custom/web
  exec ./node_modules/.bin/vite --host
  curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
  ```
- [ ] 验证完成后已停止服务并释放端口

### 4.3 develop 合并后验证

- [ ] feature 分支以 `--no-ff` 合并到 `develop` 后，在主仓库重复执行 4.1 和 4.2
