# 代码审查规范

## 审查原则

- 只读审查，不修改代码
- 关注正确性、可读性、可维护性
- 区分阻塞性问题（CRITICAL/HIGH）和建议性问题（MEDIUM/LOW）

## 审查清单

### 通用

- [ ] 代码是否符合项目编码规范
- [ ] 是否有足够的注释和文档
- [ ] 是否包含必要的测试
- [ ] 是否有重复代码
- [ ] 错误处理是否完善
- [ ] 实现是否符合当前 micro-task 范围，没有超范围功能

### Go 后端

- [ ] 是否直接修改了 `upstream/` 源码
- [ ] 业务代码是否在 `platform/` 下
- [ ] 是否有 patch 文件和说明
- [ ] 错误是否被正确包装
- [ ] 是否有 goroutine 泄漏风险

### 前端

- [ ] 组件是否职责单一
- [ ] 是否有类型定义
- [ ] API 调用是否统一
- [ ] 是否处理 loading/error 状态

## 输出格式

```markdown
### CRITICAL
### HIGH
### MEDIUM
### LOW
### APPROVE / REQUEST_CHANGES
```
