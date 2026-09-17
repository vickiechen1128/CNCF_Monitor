# MetricCenter 前端访问后端部署拓扑方案

> 背景：预生产 Ubuntu 虚拟机上部署一体化交付包后，前端页面报
> `GET http://127.0.0.1:8080/api/v1/status net::ERR_CONNECTION_REFUSED`。
> 本文记录问题根因、场景需求、方案对比与最终决策，作为后续打包改造和部署演进的依据。
>
> 关联文档：
> - `docs/06-mvp-e2e-testing/package-center-guide.md`（打包操作手册）
> - `scripts/package-center.sh`（打包脚本，本方案的改造对象）
> - `docs/05-execution-records/module-09/deploy-package-and-edge-agent-code-organization.md`（部署形态决策）

---

## 1. 问题与根因

### 1.1 现象

测试人员在 1 台 Ubuntu 虚拟机（预生产）部署 `metric-center-bundle` 后，从自己电脑的浏览器访问前端页面，所有 API 请求失败：

```text
GET http://127.0.0.1:8080/api/v1/status net::ERR_CONNECTION_REFUSED
GET http://127.0.0.1:8080/api/v2/platform/dashboard/summary net::ERR_CONNECTION_REFUSED
```

### 1.2 根因（不是跨域问题）

`ERR_CONNECTION_REFUSED` 发生在 TCP 连接阶段，浏览器尚未走到 CORS 检查。真正原因是**后端地址在构建期被写死进了前端产物**：

- `scripts/package-center.sh` 构建前端时执行 `export VITE_API_BASE_URL="http://127.0.0.1:8080"`；
- Vite 的 `VITE_*` 变量在构建期被编译进 `index-*.js`（`ui-custom/web/src/api/client.ts:6`）；
- 测试人员在**自己电脑**的浏览器里打开页面时，`127.0.0.1` 指向的是**浏览器所在的本机**，而不是那台 Ubuntu 虚拟机，本机 8080 无服务 → 连接被拒绝。

### 1.3 已排除的嫌疑

- 后端 `platform/cmd/metric-center/main.go` 已有 `cors.Default()`（允许任意源），且监听 `:8080`（所有网卡），**后端对跨域和外部访问均无问题**；
- 前端 `api/client.ts` 已支持 `VITE_API_BASE_URL` 为空时走**相对路径**——这是现成的逃生门，无需改前端代码。

---

## 2. 场景需求

| 场景 | 拓扑 | 时间 |
|------|------|------|
| S1 单机一体化（当前） | 1 台 Ubuntu：metric-center(:8080) + Prometheus(:9090) + 前端静态文件 | 现在，MVP/预生产 |
| S2 前后端分离（未来扩容） | 服务器 1：前端静态托管；服务器 2：metric-center + MySQL（SQLite 替换） | 资源不足或运维规范化时 |

要求：

1. 同一个前端产物应能部署到任意 IP/域名的服务器，**不因为换环境而重新打包**；
2. 尽量**不引入跨域**（同源优先），减少安全面配置；
3. 从 S1 演进到 S2 时，前端产物零改动，已做的工作不返工。

> 说明：SQLite → MySQL 与前端访问问题是**独立事项**。`platform/db/db.go` 使用 GORM 且已支持 `METRIC_CENTER_DB_DSN` 环境变量覆盖，届时换 `gorm.io/driver/mysql` 驱动并调整 DSN 解析即可，业务代码基本不动。另外控制面负载通常不高（瓶颈在 Prometheus 数据面），拆 MySQL 更多是为了高可用与运维规范而非容量。

---

## 3. 候选方案对比

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| A1 | 相对路径 + nginx 反代 `/api` → :8080 | 无跨域、地址自适应 | 引入 nginx 组件 |
| **A2** | 相对路径 + **metric-center 用 Gin 直接托管前端静态文件** | 单端口 8080、自包含、无跨域、无新组件 | 仅适用单机 |
| B | 构建时注入 `VITE_API_BASE_URL=http://<VM_IP>:8080` | 改动最小 | 换 IP/环境必须重新打包 |
| C | 运行时注入（构建占位符 + `start.sh` sed，或生成 `config.js`） | 免重打包 | 多一层机制；浏览器直连后端仍需 CORS |

---

## 4. 决策

**现在（S1）落地 A2；将来（S2）走"相对路径 + nginx 反代"。**

理由：

1. A2 与 S2 形态共用同一个前提——**前端永远用相对路径构建**，所以现在做 A2 不会给将来挖坑，前端产物在两个场景间零改动；
2. S1 是单机交付包，A2 只需 metric-center 一个进程对外，不引入 nginx，交付包自包含；
3. S2 拆分后同源前提必然被打破，此时标准做法是在前端服务器用 nginx 托管静态文件并反代 `/api` 到后端服务器。nginx 顺带解决 TLS 终结、gzip、访问日志、限流。C 仅在无法部署反代（如纯对象存储/CDN 托管）时作为备选；
4. 演进到 S2 时，后端的 `cors.Default()`（允许任意源，偏宽松）应收紧为白名单或直接移除——所有请求经 nginx 同源转发，不再需要 CORS。

---

## 5. S1（当前）落地 A2 的改造点

> 状态：**已实施**（2026-08-31）。`package-center-guide.md` 已同步。
> 实施过程中发现一处清单未覆盖但**不做就无法成立**的改动（认证中间件放行），见下面第 4 项。

- [x] `platform/cmd/metric-center/main.go`：新增静态文件托管
  - 新增启动参数 `--web.static-dir`（默认空 = 不托管，开发态行为不变）；
  - 非空时用 Gin 托管该目录（`registerSPA`）：`GET /` 及前端路由（history 模式 fallback 到 `index.html`）返回静态文件，`/api/*` 路由优先级高于静态兜底；
  - 现有 `cors.Default()` 在同源场景下无实际作用，保留并加注释标注（演进到 S2 后应移除或收紧为白名单）。
- [x] `scripts/package-center.sh`：
  - `build_ui()` 中**移除** `export VITE_API_BASE_URL="http://127.0.0.1:8080"`，让前端走相对路径（改用 `unset`，避免宿主 shell 残留的同名变量被误注入产物）；
  - `start.sh` 中**移除** `python3 -m http.server 5173` 段（连同 `stop.sh` 里对应的 `pkill` 兜底），改为给 metric-center 传 `--web.static-dir="$ROOT/web/ui-custom"`；
  - 更新包内 `README.md`：访问入口统一为 `http://<服务器IP>:8080`（UI 与 API 同源）。
- [x] `docs/06-mvp-e2e-testing/package-center-guide.md`：同步更新访问地址与验证清单（去掉 5173，去掉 `VITE_API_BASE_URL` 说明）。
- [x] `platform/gateway/auth/middleware.go`：**（清单外，实施时发现的必要改动）** 放行非 `/api/` 前缀请求
  - 原因：`AuthMiddleware` 在 `main.go` 中以全局 `r.Use()` 注册且**无条件**要求 Bearer token，白名单只覆盖了 OPTIONS、login 与 health。若不放行，浏览器加载 `index.html` 与 `assets/*.js` 会被 401 拦截——页面根本打不开，前端也无从携带 token。这是 A2 能否成立的前提，原清单未覆盖。
  - 约束保持：契约 §4 约束的对象是 `/api/*`，非 `/api` 路径不在其列；`/api/*` 的认证强度不变（无 token 仍 401，已加回归测试锁定）。

### 验证方法（改造后）

```bash
# 在 Ubuntu 虚拟机上
./scripts/start.sh
curl -s http://127.0.0.1:8080/api/v1/health | jq .          # API 正常（匿名放行）
curl -s http://127.0.0.1:8080/ | head -1                    # 返回 index.html
curl -s http://127.0.0.1:8080/resources | head -1           # 子路由刷新同样返回 index.html，不应 404
curl -s http://127.0.0.1:8080/api/v9/unknown | jq .         # 未注册 API 返回 JSON 错误，不返回 HTML
curl -s -o /dev/null -w '%{http_code}\n' \
     http://127.0.0.1:8080/api/v2/platform/resources        # 无 token → 401（认证强度未削弱）

# 在测试人员自己电脑的浏览器
# 访问 http://<VM_IP>:8080/，打开 DevTools 确认：
# - 页面加载正常；
# - API 请求地址为 http://<VM_IP>:8080/api/...（相对路径自适应），状态 200。
```

> 关于 `/api` 的 404 与 401 分层：`AuthMiddleware` 先于静态兜底执行，因此**未携带 token** 的 `/api/*` 请求一律 401（包括不存在的路径），404 JSON 只对**已认证**请求生效。这是更安全的默认——匿名请求无法通过「404 vs 401」的差异探测哪些 API 路径真实存在，故不视为缺陷。

---

## 6. S2（未来）前后端分离形态

拓扑：

```text
浏览器 → http://服务器1/        → nginx 托管前端静态文件（同一份相对路径产物）
浏览器 → http://服务器1/api/... → nginx 反代到 http://服务器2:8080/api/...
```

前端服务器 nginx 参考配置：

```nginx
server {
    listen 80;
    root /opt/metric-center/web/ui-custom;
    index index.html;

    location /api/ {
        proxy_pass http://<服务器2_IP>:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;   # history 路由 fallback
    }
}
```

迁移步骤（届时执行）：

1. 服务器 2 部署 metric-center（摘掉 `--web.static-dir`）+ MySQL，配置 `METRIC_CENTER_DB_DSN` 指向 MySQL；
2. 服务器 1 部署 nginx + 同一份前端产物（相对路径构建，无需重新打包）；
3. metric-center 移除 `cors.Default()` 或改为允许服务器 1 的源（此时已无跨域，建议直接移除）；
4. 后端地址只出现在 nginx 配置一处，换环境只改配置、不动产物。

---

## 7. 应急方案（未改造前临时可用）

在 A2 改造完成前，若测试人员急需验证，可按目标 VM 的实际 IP 重新打包：

```bash
VITE_API_BASE_URL=http://<VM_IP>:8080 make package-center
```

注意：该产物与 IP 绑定，仅作临时验证用，不作为正式交付方式。
