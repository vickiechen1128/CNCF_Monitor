# MetricCenter 代码编写与提交环节详细流程

> 文档类型：团队协作规范  
> 目标读者：chenrt、zhangwq  
> 更新日期：2026-07-21

---

## 1. 目标

明确 MetricCenter 项目从"需求冻结"到"代码合并到 develop"的完整工程流程，确保：

- AI 代码生成在受控范围内执行
- 每个 feature 分支都有清晰的边界和验收标准
- 代码质量由 AI 自检 + 人类 Review 双重保障
- 合并到 `develop` 的代码可随时回滚

---

## 2. 流程总览

```
Step 1: 任务接收
   chenrt 分配模块任务给 zhangwq
        │
        ▼
Step 2: 环境准备
   zhangwq 确认 worktree、切换 feature 分支
        │
        ▼
Step 3: 方案确认
   zhangwq 阅读 Module 文档，设计 prompt
        │
        ▼
Step 4: AI 开发
   zhangwq 调用 Agent 生成代码
        │
        ▼
Step 5: 人工 Review
   zhangwq 审查 AI 输出
        │
        ▼
Step 6: 测试补强
   zhangwq 补充异常路径和集成测试
        │
        ▼
Step 7: 提交前验证
   执行 go test/vet、pnpm test/lint、服务启动验证
        │
        ▼
Step 8: 提交代码
   在 feature 分支提交
        │
        ▼
Step 9: 合并申请
   zhangwq 向 chenrt 提交合并申请
        │
        ▼
Step 10: develop 合并
   chenrt 执行 --no-ff 合并
        │
        ▼
Step 11: develop 验证
   在 develop 环境中再次验证
```

---

## 3. Step 1：任务接收

### 3.1 触发条件

- Module 文档已冻结
- chenrt 决定进入开发阶段

### 3.2 负责人

- **分配人**：chenrt
- **执行人**：zhangwq

### 3.3 任务单内容

chenrt 向 zhangwq 分配任务时，应明确以下信息：

```markdown
## 开发任务单

**模块名称**：资源管理 + Excel 导入
**分支名称**：feature/module-07-resource-management
**来源 Module**：docs/02-product-requirements/Modules/Module_07_Config_Management.md
**验收标准**：
1. 三类资源 CRUD API 可用
2. Excel 导入 100 条数据，错误行返回准确
3. 前端资源管理页面可导入并展示资源
**预计工期**：3 天
**优先级**：高
**风险提示**：Excel 字段与模型字段强耦合
```

---

## 4. Step 2：环境准备

### 4.1 确认 worktree

本项目采用 **单一 feature worktree 复用** 模式：

```bash
# 进入 worktree
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"

# 确认当前在 worktree 中
git rev-parse --git-dir
# 输出应包含 .git/worktrees/
```

### 4.2 切换/创建 feature 分支

```bash
# 方式 A：分支已存在
git checkout feature/module-XX-<功能名>

# 方式 B：从 develop 新建分支
git fetch origin
git checkout -b feature/module-XX-<功能名> origin/develop
```

### 4.3 环境检查

- 后端：`go version`、`go env GOROOT`
- 前端：`pnpm --version`、`node --version`
- 工具链：`make install-tools`（如需要）

---

## 5. Step 3：方案确认

### 5.1 zhangwq 动作

1. 仔细阅读 Module 文档
2. 阅读相关工程标准：
   - `03_API_Standard.md`
   - `04_Testing_Standard.md`
   - `01_Code_Isolation_Standard.md`
3. 识别技术风险点（SSRF、SQL 注入、配置下发等）
4. 设计给 AI 的 prompt

### 5.2 Prompt 设计原则

一个好的 prompt 应包含：

- **背景**：当前模块目标、依赖模块
- **输入**：需要阅读的文档路径
- **输出**：需要修改/新增的文件列表
- **约束**：API 路径、响应格式、测试要求、安全要求
- **验收标准**：测试通过、服务启动验证

### 5.3 Prompt 模板

```markdown
请作为 backend-developer，基于以下文档完成 Module 07 资源管理后端 API 开发：

**必读文档**：
- docs/02-product-requirements/Modules/Module_07_Config_Management.md
- docs/03-engineering-standards/03_API_Standard.md
- docs/03-engineering-standards/04_Testing_Standard.md

**任务**：
1. 实现 Host / Middleware / Application 的 CRUD API
2. 实现 Excel 导入功能
3. 实现 Excel 模板下载功能

**约束**：
- 平台能力 API 使用 /api/v2/platform/* 前缀
- 使用 GORM + SQLite
- 所有导出函数必须有注释
- URL 解析必须校验 scheme 和 host，防范 SSRF

**验收标准**：
1. go test ./platform/... 通过
2. go vet ./platform/... 通过
3. 启动服务后 /api/v2/platform/resources 返回正确 JSON
```

---

## 6. Step 4：AI 开发

### 6.1 zhangwq 调用 Agent

- 后端开发：调用 `backend-developer`
- 前端开发：调用 `frontend-developer`
- Prometheus 扩展：调用 `prometheus-developer`
- 构建修复：调用 `build-resolver`

### 6.2 过程监督

zhangwq 在 AI 开发过程中应：

- 确保 AI 在正确的 feature 分支上工作
- 确保 AI 不修改无关文件
- 及时纠正偏离需求的实现方向
- 遇到阻塞（如网络、工具链）及时处理或升级给 chenrt

### 6.3 范围控制

- 一个 feature 分支只做一个模块
- 不要在当前 feature 分支混入其他模块改动
- 如需修改公共基础设施（如 response 封装），需先与 chenrt 确认

---

## 7. Step 5：人工 Review

### 7.1 Review 负责人

- **第一责任人**：zhangwq
- **第二责任人**：chenrt（合并前最终 Review）

### 7.2 Review 清单

#### 7.2.1 安全性

- [ ] URL 解析是否校验 scheme（仅 `http`/`https`）和 host
- [ ] 是否防范 SSRF
- [ ] 是否防范 SQL 注入
- [ ] 文件写入是否校验路径
- [ ] 配置下发是否有权限控制
- [ ] 是否有敏感信息泄露风险

#### 7.2.2 正确性

- [ ] 实现是否符合 Module 文档
- [ ] API 路径和响应格式是否符合 `03_API_Standard.md`
- [ ] 数据模型是否与 Module 文档一致
- [ ] 错误处理是否完善

#### 7.2.3 可维护性

- [ ] 函数长度是否小于 50 行
- [ ] 文件长度是否小于 800 行
- [ ] 命名是否清晰
- [ ] 是否有重复代码
- [ ] 是否有过度工程化

#### 7.2.4 可测试性

- [ ] 是否覆盖 happy path
- [ ] 是否覆盖边界情况
- [ ] 是否覆盖错误路径

### 7.3 Review 不通过处理

- zhangwq 记录问题
- 返回对应 Agent 修复
- 修复后重新 Review

---

## 8. Step 6：测试补强

### 8.1 AI 测试的局限性

AI 通常能写出 happy path 测试，但容易遗漏：

- 异常输入
- 并发场景
- 权限边界
- 集成依赖

### 8.2 zhangwq 应补充的测试

#### 后端

- 空输入、超大值、特殊字符
- 404、400、校验失败
- 并发读写
- 数据库迁移兼容性

#### 前端

- 空列表状态
- 加载失败状态
- 表单校验边界
- 网络异常处理

---

## 9. Step 7：提交前验证

### 9.1 后端验证

```bash
# 静态检查
go test ./platform/...
go vet ./platform/...

# 服务启动验证
go run ./platform/cmd/metric-center/main.go

# 验证接口
curl http://localhost:8080/api/v1/health
curl http://localhost:8080/api/v1/health/db
curl http://localhost:8080/api/v1/status
```

### 9.2 前端验证

```bash
# 静态检查
cd ui-custom/web
pnpm test
pnpm lint

# 服务启动验证
exec ./node_modules/.bin/vite --host

# 验证页面
curl -I http://localhost:5173/
```

### 9.3 验证通过标准

| 检查项 | 通过标准 |
|--------|----------|
| `go test ./platform/...` | 全部通过 |
| `go vet ./platform/...` | 无问题 |
| `pnpm test` | 全部通过 |
| `pnpm lint` | 0 errors / 0 warnings |
| 后端服务启动 | 关键接口返回 200 |
| 前端 dev server | 页面返回 200 |

### 9.4 验证后清理

验证完成后必须停止服务，释放端口：

```bash
# 停止后端服务
Ctrl+C

# 停止前端服务
Ctrl+C
```

---

## 10. Step 8：提交代码

### 10.1 提交规范

```bash
git add <具体文件>
git commit -m "<类型>: <简要描述>

<详细说明>

关联: <执行记录路径>"
```

### 10.2 Commit 类型

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 |
| `docs` | 文档 |
| `test` | 测试 |
| `refactor` | 重构 |
| `chore` | 工程事务 |
| `prototype` | 原型设计 |

### 10.3 Commit 示例

```bash
git commit -m "feat: 实现资源管理 CRUD 与 Excel 导入

- 新增 Host/Middleware/Application CRUD API
- 新增 Excel 批量导入与错误行返回
- 新增 Excel 模板下载

关联: docs/04-execution-records/module-07-resource-management/backend-developer.md"
```

### 10.4 提交前确认

- 当前在正确的 feature 分支
- 提交只包含当前模块改动
- commit message 符合规范

---

## 11. Step 9：合并申请

### 11.1 zhangwq 输出

向 chenrt 提交合并申请，包含：

```markdown
## 合并申请

**分支**：feature/module-XX-<功能名>
**来源 Module**：Module_XX_*.md
**变更范围**：
- 新增/修改文件列表

**测试结果**：
- go test ./platform/...：通过
- go vet ./platform/...：通过
- pnpm test：通过
- pnpm lint：通过

**服务验证**：
- 后端服务启动成功，/api/v1/health 返回 200
- 前端 dev server 启动成功，/ 返回 200

**Review 结论**：
- 自查通过 / 发现 XX 问题已修复

**风险点**：
- XXX

**建议下一步**：
- 合并到 develop
```

### 11.2 chenrt 审批

chenrt 收到申请后：

1. 检查变更范围是否符合 Module 文档
2. 检查测试和验证结果
3. 检查 commit message 是否规范
4. 必要时进行最终 Review
5. 决定：批准合并 / 要求修复 / 暂缓

---

## 12. Step 10：develop 合并

### 12.1 合并条件

- zhangwq Review 通过
- 提交前验证通过
- chenrt 审批通过

### 12.2 合并操作

在主仓库 `CNCF_Monitor` 中执行：

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"
git checkout develop
git pull origin develop
git merge --no-ff feature/module-XX-<功能名>
```

### 12.3 合并后推送

```bash
git push origin develop
```

---

## 13. Step 11：develop 验证

### 13.1 验证要求

合并到 develop 后，必须再次执行提交前验证：

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"

# 后端测试
go test ./platform/...
go vet ./platform/...

# 前端检查
cd ui-custom/web
pnpm test
pnpm lint

# 服务启动验证
go run ./platform/cmd/metric-center/main.go
exec ./node_modules/.bin/vite --host
```

### 13.2 验证失败处理

- 立即停止后续模块开发
- 在 develop 上修复或回退合并
- 修复后重新验证

### 13.3 回退命令

如 develop 验证失败，可回退：

```bash
# 查看合并 commit
git log --oneline -5

# 方式 1：revert 合并（保留历史）
git revert -m 1 <merge-commit-hash>

# 方式 2：reset 到合并前（仅在未 push 时使用）
git reset --hard <合并前的 commit>
```

---

## 14. 原型分支特殊流程

### 14.1 原型开发

- 由 chenrt 调用 `prototype-designer`
- 分支名：`feature/prototype-<名称>`
- 使用 mock 数据，不连接后端

### 14.2 原型分支推送

原型完成后推送到远程仓库，方便团队查看：

```bash
git push -u origin feature/prototype-<名称>
```

### 14.3 原型分支处理原则

- **不合并到 `develop`**，避免污染正式开发主线。
- 必须推送到远程仓库 `origin/feature/prototype-<名称>`，团队成员可通过 `git fetch` 拉取。
- **推荐部署到 GitHub Pages**，方便 guixm、zhaohy 等非工程人员在线预览。
- 原型中的有效设计需在正式模块分支重新实现后合并到 `develop`。
- **原型分支只放 UI 原型代码**。PRD、团队协作文档、工程标准、Agent 定义必须在 `develop` 上维护，确保业务侧（guixm、zhaohy）和 SRE 工程师（zhangwq）看到的是同一份最新资料。

---

## 15. 原型在线预览方案（GitHub Pages）

### 15.1 为什么需要在线预览

- guixm、zhaohy 不需要配置本地开发环境即可查看原型。
- 原型用于需求汇报和确认，链接可直接分享。
- 与 `develop` 中的正式代码隔离，不影响开发。
- PRD、团队协作文档、工程标准统一放在 `develop`，GitHub Pages 只承载原型 UI，避免业务侧因文档分散而找不到最新资料。

### 15.2 方案 A：手动部署到 GitHub Pages（推荐首次使用）

#### 步骤 1：配置 Vite 基础路径

在 `ui-custom/web/vite.config.ts` 中，为原型构建设置 `base`：

```typescript
export default defineConfig({
  base: '/CNCF_Monitor/',
  // ...
})
```

> 仅原型构建时修改，正式开发保持默认 `/`。可通过环境变量区分。

#### 步骤 2：构建原型

```bash
cd ui-custom/web
pnpm install
pnpm build
```

构建产物在 `ui-custom/web/dist/`。

#### 步骤 3：推送到 `gh-pages` 分支

```bash
cd ui-custom/web/dist
git init
git remote add origin https://github.com/<your-org>/CNCF_Monitor.git
git checkout -b gh-pages
git add .
git commit -m "deploy: prototype-mvp-demo"
git push -f origin gh-pages
```

#### 步骤 4：启用 GitHub Pages

1. 打开 GitHub 仓库 Settings → Pages
2. Source 选择 `Deploy from a branch`
3. Branch 选择 `gh-pages / root`
4. 保存后访问：`https://<your-org>.github.io/CNCF_Monitor/`

### 15.3 方案 B：GitHub Actions 自动部署（推荐后续迭代）

在 `.github/workflows/deploy-prototype.yml` 中配置：

```yaml
name: Deploy Prototype to GitHub Pages

on:
  push:
    branches:
      - 'feature/prototype-*'

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
          cache-dependency-path: ui-custom/web/pnpm-lock.yaml
      - run: cd ui-custom/web && pnpm install && pnpm build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./ui-custom/web/dist
          destination_dir: ${{ github.ref_name }}
```

每个 `feature/prototype-*` 分支推送后，自动部署到：

```
https://<your-org>.github.io/CNCF_Monitor/feature/prototype-mvp-demo/
```

### 15.4 prototype-designer 是否需要实现自动发布？

`prototype-designer` 的核心目标是快速产出可点击原型，**不要求**它直接发布到 GitHub Pages。但可以在原型完成后：

- 由 `prototype-designer` 生成 `vite.config.ts` 的 `base` 配置注释说明
- 由 `prototype-designer` 输出"如何构建和部署到 GitHub Pages"的步骤
- 由 chenrt 或 zhangwq 手动/自动执行部署

如需完全自动化，可在 `prototype-designer` 的完成汇报中增加：

```markdown
## GitHub Pages 部署说明

1. 确认仓库已启用 GitHub Pages
2. 设置 vite.config.ts base 为 '/CNCF_Monitor/'
3. 运行 pnpm build
4. 将 dist/ 推送到 gh-pages 分支
5. 访问 https://<your-org>.github.io/CNCF_Monitor/
```

---

## 16. 业务侧验收路径

业务侧（guixm、zhaohy）需要在两个阶段参与验收：

### 16.1 第一阶段：原型验收（需求确认前）

| 项目 | 说明 |
|------|------|
| **查看方式** | GitHub Pages 在线链接 |
| **负责人** | chenrt 组织，guixm + zhaohy 评审 |
| **目标** | 确认页面布局、流程、字段是否符合业务预期 |
| **输出** | 原型评审会议纪要、修改意见 |
| **是否影响 develop** | 否 |

### 16.2 第二阶段：功能验收（合并到 develop 后）

| 项目 | 说明 |
|------|------|
| **查看方式** | 本地/测试环境启动正式服务 |
| **负责人** | chenrt 组织，guixm + zhaohy 验收 |
| **目标** | 确认真实功能是否解决一线问题 |
| **输出** | 业务验收结论 |
| **是否影响 develop** | 是，验收不通过需在 develop 修复或回退 |

### 16.3 如何给业务侧提供功能验收环境

#### 方式 1：本地演示（适合小范围、早期阶段）

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"
git checkout develop
go run ./platform/cmd/metric-center/main.go
cd ui-custom/web && exec ./node_modules/.bin/vite --host
```

业务侧通过 chenrt 的电脑屏幕或远程桌面查看。

#### 方式 2：测试环境部署（推荐正式验收）

- 在 develop 合并后，由 zhangwq 部署到团队测试服务器。
- 提供固定 URL，guixm/zhaohy 自行访问。
- 可结合 CI/CD 自动部署 develop 分支到测试环境。

#### 方式 3：GitHub Codespaces / Vercel 预览（可选）

- GitHub Codespaces：业务方可直接在浏览器中打开开发环境。
- Vercel：连接 GitHub 仓库，自动为每个 PR/分支生成预览链接。

### 16.4 验收不通过的处理

| 阶段 | 处理方式 |
|------|----------|
| 原型验收不通过 | 在 `feature/prototype-*` 分支迭代，不合并到 develop |
| 功能验收不通过 | 在 develop 修复或 `git revert` 回退，重新开发 |

---

## 17. 执行记录

每个 feature 开发完成后，应在 `docs/04-execution-records/` 下创建执行记录：

```
docs/04-execution-records/
├── module-XX-<功能名>/
│   ├── planner.md
│   ├── backend-developer.md
│   ├── frontend-developer.md
│   ├── golang-reviewer.md
│   ├── frontend-reviewer.md
│   └── merge-record.md
```

---

## 18. 相关文档

- [`00_Team_Charter.md`](00_Team_Charter.md) — 团队守则
- [`01_Role_Responsibilities.md`](01_Role_Responsibilities.md) — 角色职责速查表
- [`02_Demand_Workflow.md`](02_Demand_Workflow.md) — 需求设计环节详细流程
- [`../03-engineering-standards/03_API_Standard.md`](../03-engineering-standards/03_API_Standard.md) — API 标准
- [`../03-engineering-standards/04_Testing_Standard.md`](../03-engineering-standards/04_Testing_Standard.md) — 测试标准
- [`../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md`](../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md) — 分支策略与回退指南
