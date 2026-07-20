# MetricCenter 代码隔离标准

> 文档类型：工程标准
> 目标：明确 Prometheus 源码与 MetricCenter 二次开发代码的边界，确保 upstream 可升级、业务代码可维护。
> 更新日期：2026-07-16

---

## 1. 核心原则

1. **upstream 目录只放原始源码**：`upstream/prometheus/`、`upstream/node_exporter/` 尽量保持原样。
2. **业务代码全部位于 platform/**：所有 MetricCenter 专属能力在 `platform/` 下开发。
3. **必要修改必须 patch 化**：如果必须改动 upstream 源码，通过 `patches/` 管理，并附说明文档。
4. **入口程序独立**：通过 `platform/cmd/metric-center/main.go` 包装 Prometheus 入口，而不是直接修改 upstream 的 main.go。

---

## 2. 目录隔离规则

| 目录 | 用途 | 是否允许直接修改 |
|------|------|-----------------|
| `upstream/prometheus/` | Prometheus 原始源码 | ❌ 否，必要修改通过 patch |
| `upstream/node_exporter/` | node_exporter 原始源码 | ❌ 否 |
| `platform/` | MetricCenter 业务扩展代码 | ✅ 是 |
| `ui-custom/` | 独立前端门户 | ✅ 是 |
| `patches/prometheus/` | 对 upstream 的必要 patch | ✅ 是，但需严格审批 |
| `scripts/` | 构建、打 patch、部署脚本 | ✅ 是 |
| `deploy/` | Docker、K8s、Compose 配置 | ✅ 是 |

---

## 3. 允许修改 upstream 的场景

以下情况允许修改 upstream 源码，但必须 patch 化：

| 场景 | 示例 | 替代方案 |
|------|------|----------|
| 入口包装 | 在 `cmd/prometheus/main.go` 注册自定义发现 | ✅ 推荐：独立入口 `platform/cmd/metric-center/main.go`，import 副作用注册 |
| 路由扩展 | 在 web 路由中增加自定义 API | ⚠️ 可选：通过独立 Gateway 代理 |
| UI 资源路径 | 修改静态资源目录 | ⚠️ 可选：独立前端门户 `ui-custom/` |
| 核心接口实现 | 实现新的 Discoverer | ✅ 推荐：在 `platform/discovery/` 实现并通过 import 注册 |

**优先使用扩展点，其次使用独立组件，最后才考虑 patch。**

---

## 4. Patch 管理规范

### 4.1 Patch 生成流程

1. 在 `upstream/prometheus/` 中完成必要修改
2. 使用 `git diff` 生成 patch：
   ```bash
   cd upstream/prometheus
   git diff > ../../patches/prometheus/0001-<简短描述>.patch
   ```
3. 在 `patches/prometheus/README.md` 中记录 patch 用途、影响范围和验证方法

### 4.2 Patch 命名

```
0001-add-custom-discovery-hook.patch
0002-expose-web-router-for-extension.patch
0003-custom-ui-assets-path.patch
```

### 4.3 Patch 应用

在 `scripts/apply-patches.sh` 中统一应用：

```bash
#!/bin/bash
set -e
cd upstream/prometheus
for patch in ../../patches/prometheus/*.patch; do
    echo "Applying $patch"
    git apply "$patch"
done
```

---

## 5. 代码审查清单

提交代码前检查：

- [ ] 新增业务代码是否都在 `platform/` 或 `ui-custom/` 下？
- [ ] 是否直接修改了 `upstream/` 下的源码？
- [ ] 如果修改了 upstream，是否生成了 patch 文件？
- [ ] patch 文件是否有对应的说明文档？
- [ ] 是否可以通过 `make build` 成功编译？
- [ ] 是否可以通过 `make apply-patches` 正确应用 patch？

---

## 6. 常见反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 直接在 `upstream/prometheus/discovery/` 下新增发现源 | 升级 upstream 时难以合并 | 在 `platform/discovery/` 实现，通过 import 注册 |
| 修改 `upstream/prometheus/web/ui/` 大量文件 | UI 与 upstream 深度耦合 | 独立 `ui-custom/` 门户 |
| 复制 upstream 文件到 platform 后大量修改 | 失去 upstream 更新能力 | 尽量使用组合和接口扩展 |
| patch 文件没有说明 | 后人不知道为何修改 | 每个 patch 必须有 README 条目 |
