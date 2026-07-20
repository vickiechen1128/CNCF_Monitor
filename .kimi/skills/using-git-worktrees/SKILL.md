# Git Worktree 使用规范

## 为什么使用 Worktree

- 多个 Agent 可以并行工作
- 每个 Agent 有独立的文件系统
- 失败时可以直接丢弃 worktree

## 常用命令

```bash
# 创建 worktree
git worktree add ../CNCF_Monitor-feature-xxx -b feature/xxx

# 进入 worktree
cd ../CNCF_Monitor-feature-xxx

# 查看所有 worktree
git worktree list

# 删除 worktree
git worktree remove ../CNCF_Monitor-feature-xxx
git branch -d feature/xxx
```

## 命名规范

```
CNCF_Monitor-feature-<timestamp>
CNCF_Monitor-feature-<module>-<description>
```

## 注意事项

- 不要在主工作区直接开发
- 每个 worktree 对应一个功能分支
- 开发完成后清理 worktree
