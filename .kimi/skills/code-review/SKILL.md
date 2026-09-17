# 代码审查规范

## 审查原则

- 只读审查，不修改代码
- 关注正确性、可读性、可维护性
- 区分阻塞性问题（CRITICAL/HIGH）和建议性问题（MEDIUM/LOW）

## 轨道参数化（v2026-09-17 起）

审查前必须从 Orchestrator 任务卡中获取**轨道标记**（Track A / Track B / Track B+），按轨道选择对照基准：

| 轨道 | 前端审查基准 | 后端审查基准 |
|------|-------------|-------------|
| **Track A** | 原型页面 + `frontend-prototype-map.md` + `api-contract-snapshot.md` | PRD + `api-contract-snapshot.md` |
| **Track B/B+** | `dev-ready` 轻量规格 PRD 章节 + `api-contract-snapshot.md`（无原型） | 轻量规格 PRD + `api-contract-snapshot.md` |

## 审查清单

### 通用（两轨通用）

- [ ] 代码是否符合项目编码规范
- [ ] 是否有足够的注释和文档
- [ ] 是否包含必要的测试
- [ ] 是否有重复代码
- [ ] 错误处理是否完善
- [ ] 实现是否符合当前 micro-task 范围，没有超范围功能
- [ ] **契约一致性**：实现响应结构（字段名/枚举/嵌套层级）是否与 `api-contract-snapshot.md` 逐项一致；不一致必须标记为 HIGH

### Go 后端

- [ ] 是否直接修改了 `upstream/` 源码
- [ ] 业务代码是否在 `platform/` 下
- [ ] 是否有 patch 文件和说明
- [ ] 错误是否被正确包装
- [ ] 是否有 goroutine 泄漏风险

### 前端（按轨道）

- [ ] 组件是否职责单一
- [ ] 是否有类型定义
- [ ] API 调用是否统一
- [ ] 是否处理 loading/error 状态
- [ ] **Track A**：原型符合度——表格列集合、导航文案、UI 展示名是否与 `frontend-prototype-map.md` 一致（对照 `frontend-reviewer.md` 原型符合度六项）
- [ ] **Track B/B+**：验收清单覆盖度——字段表/接口清单/验收清单是否全部覆盖；AntD 标准模式符合性

## 输出格式

```markdown
### CRITICAL
### HIGH
### MEDIUM
### LOW
### APPROVE / REQUEST_CHANGES
```
