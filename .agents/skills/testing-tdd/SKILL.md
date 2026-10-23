---
name: testing-tdd
description: "MetricCenter TDD 与测试规范：RED/GREEN/IMPROVE、Go/前端测试、验证矩阵、测试时长控制、flaky 处理与覆盖率目标"
---

# TDD 测试规范

本 Skill 是开发类 Agent 的测试与提交前验证基线。所有测试命令默认在项目根目录执行；前端命令在 `ui-custom/web/` 下执行。

---

## 1. TDD 循环

```text
RED → GREEN → IMPROVE → VERIFY
```

1. **RED**：先写测试，覆盖正常路径、边界情况、错误路径；运行并确认测试失败。
2. **GREEN**：写最小实现让测试通过。
3. **IMPROVE**：消除重复、提取函数、优化命名；再次运行测试。
4. **VERIFY**：按下方「提交前验证矩阵」完成静态检查与服务验证。

- 后端必须 TDD。
- 前端至少先写组件行为测试或明确验收断言；纯样式调整可豁免，但需在汇报中说明。
- 测试通过不代表服务能启动；提交前必须做服务启动验证。

---

## 2. 测试用例覆盖

每个功能至少覆盖：

- **正常路径**：典型输入、典型响应。
- **边界情况**：空输入、超大值、特殊字符、分页边界、枚举边界。
- **错误路径**：400 / 404 / 409 / 校验失败 / 依赖失败。
- **契约**：字段名、枚举、嵌套结构、错误类型与契约快照一致。

---

## 3. Go 后端测试

### 3.1 单元测试

```go
func TestLoadConfig(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    *Config
        wantErr bool
    }{
        {name: "valid config", input: "testdata/valid.yml", want: &Config{}},
        {name: "missing file", input: "testdata/missing.yml", wantErr: true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := LoadConfig(tt.input)
            if tt.wantErr {
                assert.Error(t, err)
                return
            }
            assert.NoError(t, err)
            assert.Equal(t, tt.want, got)
        })
    }
}
```

- 使用标准 `testing` + `testify/assert` / `require`。
- 外部依赖通过接口注入或 mock。
- 数据库测试优先使用内存 DSN：`file::memory:?cache=shared`。
- 并发相关代码提供 `go test -race` 结果（如适用）。
- 不修改 `upstream/prometheus/` 原有测试；patch 影响 upstream 测试时必须在 patch README 标注。

### 3.2 集成测试

- 使用 `testcontainers-go` 或本地 Docker 启动依赖服务。
- 或使用 SQLite 内存数据库。
- 覆盖关键路径：发现源同步、查询代理、认证鉴权、配置下发。

### 3.3 常用命令

```bash
# 目标包（开发中默认）
go test ./platform/<pkg>/...

# 全量后端
go test ./platform/...

# 静态检查
go vet ./platform/...

# 竞态（并发相关）
go test -race ./platform/<pkg>/...
```

---

## 4. 前端测试

- 单元 / 组件测试：Vitest + React Testing Library。
- E2E：Playwright（按任务要求）。
- antd 组件测试稳定模式见 `web-development` 的「Ant Design 组件测试稳定模式」。
- 测试文件类型门禁：`pnpm run typecheck:test`（秒级，必做）。

### 4.1 测试命令分级

```bash
cd ui-custom/web

# 单文件（开发中默认）
pnpm vitest run src/pages/<module>/__tests__/<File>.test.tsx

# 目录级
pnpm vitest run src/pages/<module>

# 变更范围回归（Phase 收尾默认）
pnpm run typecheck:test
pnpm vitest run --changed ../origin/develop
pnpm lint

# 全量（仅限下方允许情形）
pnpm test
```

### 4.2 全量测试适用条件

`pnpm test` 不是默认收尾动作。8 GB 机型全量实测约 **17 分钟**（94 文件 / 915 用例；测试执行本身仅 2.8 分钟），慢在「文件数 × 模块转换开销」。

只有以下三种情况允许跑全量，且需在执行记录说明理由：

1. 用户明确要求；
2. 合并 / 发 PR 前的最终把关；
3. 改动跨 ≥3 个顶层目录，或触及 `src/api/`、`src/types/`、`src/test/` 等共享层（此时 `--changed` 的传导不可信）。

**禁止的提速手法：**

- 禁止为提速调高 `maxWorkers` 或改 `pool`：8 GB 机型 4 worker / `threads` 实测被 SIGKILL（exit 137）。
- 禁止删测试、加 `.skip` 或关闭 `isolate`。
- 禁止用 `--bail` 只跑首个失败即停。
- `--changed` 结果为空不是失败（纯文档改动等），在记录中说明即可。

### 4.3 增量/修复阶段测试范围（`mode: incremental`）

任务卡标记 `mode: incremental` 时，**默认不跑全量 `pnpm test`**，最小验证为：

| 层 | 命令 | 说明 |
|----|------|------|
| 功能测试 | `pnpm vitest run <本次变更涉及的单文件/目录>` | 覆盖被改行为；纯后端改为对应包 `go test` |
| 类型门禁 | `pnpm run typecheck:test` | 秒级 |
| Lint | `pnpm lint` | |
| 服务启动 | dev server / 后端服务 + 关键接口 200 | 验证「现有功能未破坏」 |

- 「功能性测试」指上述目标测试 + 服务启动验证，**不能只靠手工点点页面替代自动化目标测试**。
- 全量 `pnpm test` 仍按 §4.2 三种情形触发；增量阶段默认不需要。
- 技术债修复（`debt:` 提交）同样只要求最小验证 + 现有测试通过。

---

## 5. 覆盖率目标

| 模块 | 目标覆盖率 |
|------|-----------|
| `platform/gateway` | ≥ 70% |
| `platform/discovery` | ≥ 70% |
| `platform/collector` | ≥ 60% |
| `platform/config` | ≥ 70% |
| `ui-custom/web` | ≥ 50% |

覆盖率是下限，不是替代行为测试的理由。

---

## 6. 提交前验证矩阵

### 6.1 后端变更（`platform/`）

```bash
go test ./platform/...
go vet ./platform/...

# 启动服务（非阻塞）
GOPROXY=off go run ./platform/cmd/metric-center/main.go

# 另一个终端验证
curl -s http://localhost:8080/api/v1/health
curl -s http://localhost:8080/api/v1/health/db
curl -s http://localhost:8080/api/v1/status
```

- 新增 / 修改 API 必须额外验证对应接口。
- 验证完成后停止服务，释放端口。

### 6.2 前端生产代码变更（`ui-custom/web/`）

**增量 commit：**

```bash
cd ui-custom/web
pnpm lint
pnpm vitest run <本次变更涉及的测试文件>
exec ./node_modules/.bin/vite --host
# 另一个终端
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
```

**Phase 收尾 / 合并前：**

```bash
cd ui-custom/web
pnpm run typecheck:test
pnpm vitest run --changed ../origin/develop
pnpm lint
pnpm build
```

### 6.3 Patch 变更（`patches/prometheus/`）

```bash
make apply-patches
make build-prometheus
make test-platform
```

### 6.4 文档 / Agent / Skill 变更

- 至少检查：无密钥、无临时文件、无意外修改生产代码。
- 如仓库配置 markdown lint，运行对应 lint。
- Skill 变更后运行 `make sync-skills && make check-skills`。

### 6.5 develop 合并后

- feature 分支 `--no-ff` 合并到 `develop` 后，在 `develop` 重复 6.1 / 6.2 验证。

---

## 7. Flaky 测试处理

- 禁止以「重试 2 次即算通过」作为常规验收标准。
- 优先修根因：
  - 用 `await screen.findBy*` / `waitFor` 处理异步渲染；
  - 用 `userEvent.setup()`；
  - antd `Modal` / `Select` / `Drawer` 使用 `src/test/antdTestUtils.tsx`；
  - mock `matchMedia`、`getComputedStyle`、`scrollTo`、`ResizeObserver`。
- 暂时无法根除时：
  - 隔离到 `*.flaky.test.tsx` 或加 `// FLAKY: root cause & tracking issue`；
  - 在执行记录中挂账，限期修复；
  - 不得以普通用例身份进入全量回归。

---

## 8. 常见环境问题

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| `compile: version goX does not match go tool version goY` | `GOROOT` 指向系统其他 Go | `unset GOROOT` 后重试，或让 Orchestrator 统一设置 |
| `make build-prometheus` 因 `upstream/prometheus/` 不存在失败 | 子模块未初始化 | 由 Orchestrator 执行 `git submodule update --init` |
| `go test` / `go vet` 长时间挂起 | GOPROXY 网络慢 | 尝试 `GOPROXY=off`（仅本地缓存） |
| `pnpm install` 提示 `ignored builds` | pnpm v11 禁用 postinstall | 在 `pnpm-workspace.yaml` 声明 `allowBuilds: { esbuild: true }`，并包含 `packages: ['.']` |
| 全量前端测试 exit 137 | 内存不足 / worker 过多 | 保持 `maxWorkers: 2`，改用 `--changed` 缩小范围 |

环境问题无法自行解决时，停止并报告 Orchestrator。
