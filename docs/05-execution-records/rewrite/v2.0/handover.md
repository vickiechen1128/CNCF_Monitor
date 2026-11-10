# MetricCenter v2.0 交接清单（Handover）

> 目标：把项目级工具产品重写为可移交给正式开发团队的 v2.0。
> 每个模块在 R6 前必须完成对应条目；R6 汇总为整版交接包。

---

## 1. 产品与需求

- [ ] 业务需求文档（`business-requirements.md`）完整，目标 / 用户 / 场景 / 非目标清晰。
- [ ] 新 PRD 与实现一致，版本 / Change Log 可追溯。
- [ ] 删除 / 变更的旧功能有登记与理由。

## 2. 架构与数据

- [ ] 架构图 / 模块边界 / 依赖关系。
- [ ] 逻辑数据模型 + 物理列映射 + 身份键 / 唯一索引 / 关联完整性。
- [ ] API v3 契约快照；旧 v2 对照表。
- [ ] migration / 回滚 / 数据迁移说明。

## 3. 质量与安全

- [ ] 单元 / 集成 / E2E 测试与覆盖率。
- [ ] 旧 vs 新行为矩阵（保留 / 变更 / 删除）。
- [ ] 安全审查（认证、鉴权、密钥、配置下发、SSRF）。
- [ ] R1–R4 / lint / vet 通过。

## 4. 运维与交接

- [ ] 部署 / 升级 / 回滚 runbook。
- [ ] 环境变量 / 配置说明。
- [ ] README / onboarding / 已知问题 / roadmap。
- [ ] 旧版本基线 tag 与差异说明。

---

## 5. 模块清单

| 模块 | PRD | 代码 | 测试 | 迁移 | handover | 状态 |
|---|---|---|---|---|---|---|
| M00 | todo | todo | todo | todo | todo | todo |
| M07 | doing | doing | todo | todo | todo | doing |
| M06 | todo | todo | todo | todo | todo | todo |
| M01 | todo | todo | todo | todo | todo | todo |
| M09 | todo | todo | todo | todo | todo | todo |
| M02 | todo | todo | todo | todo | todo | todo |
| M08 | todo | todo | todo | todo | todo | todo |
| M05 | todo | todo | todo | todo | todo | todo |
| 其他 | todo | todo | todo | todo | todo | todo |
