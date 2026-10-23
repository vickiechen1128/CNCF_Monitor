# 跨工具共享资产

本目录中的 `skills/` 由 `scripts/sync-skills.sh` 从 `.kimi/skills/` 生成，**请勿直接修改**。

- 单一源：`.kimi/skills/`
- 共享镜像：`.agents/skills/`
- 同步：`bash scripts/sync-skills.sh`
- 校验：`bash scripts/sync-skills.sh check`

OpenCode、Trae、Kimi Code CLI 会自动发现 `.agents/skills/` 下的 `SKILL.md`。
