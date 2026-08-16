# MetricCenter 模块原型总览

本目录按模块拆分了 MetricCenter 的可点击前端原型，用于 PRD 验证、业务评审与开发输入。

## 目录结构

```text
docs/prototypes/
├── index.html          # 统一入口：模块地图与访问方式
├── build-all.sh        # 一键构建全部模块
├── README.md           # 本文件
├── module-01/          # 监控策略与指标管理
├── module-02/          # 查询中心
├── module-03/          # 网关与认证
├── module-04/          # 自定义服务发现
├── module-05/          # 自定义前端门户
├── module-06/          # 系统与平台管理
├── module-07/          # 监控对象管理
├── module-08/          # 告警收敛与通知管理
├── module-09/          # 网域与边缘配置中心
└── module-10/          # 监控源登记册
```

## 快速访问（统一视图）

### 方式一：开发模式（独立端口，支持热更新）

每个模块独立运行，适合单模块调试：

```bash
cd docs/prototypes/module-07
pnpm install
pnpm dev
```

默认端口规划（可在对应 `vite.config.ts` 中修改）：

| 模块 | 端口 |
|------|------|
| module-05 | 5173 |
| module-07 | 5174 |
| module-01 | 5175 |
| module-02 | 5176 |
| module-08 | 5177 |
| module-09 | 5178 |
| module-10 | 5179 |
| module-03 | 5180 |
| module-04 | 5181 |
| module-06 | 5182 |

打开浏览器访问 http://localhost:5173/ 等。

### 方式二：构建模式（统一静态入口）

适合一次性向领导/业务方展示所有模块：

```bash
cd docs/prototypes
./build-all.sh

# 启动静态服务器
python3 -m http.server 8080
```

然后访问 http://localhost:8080/ ，从统一入口点击进入任意模块。

> **验证要求**：每个模块原型除了 `pnpm dev` 验证外，还必须在统一入口下验证 `http://localhost:8080/module-XX/dist/index.html` 能正常渲染，确保与 GitHub Pages 部署结构一致。
>
> **注意**：`dist/index.html` 必须通过 HTTP 服务访问，直接双击用 `file://` 协议打开会因 ES Module 安全策略导致白屏。

## 设计规范

- 技术栈：React 18 + TypeScript + Vite + Ant Design 5
- 视觉风格：火山引擎 Volcengine Token
  - 主色：`#0ECDEB`
  - 头部背景：`#0B1B2A`
  - 成功/警告/错误：`#00B578` / `#FA8C16` / `#FF4C3A`
- 数据：全部使用本地 mock 数据，不调用真实 API

## 与 PRD 的对应关系

| 原型目录 | 对应 PRD |
|----------|----------|
| module-01 | `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md` |
| module-02 | `docs/02-product-requirements/Modules/Module_02_Query_Center.md` |
| module-03 | `docs/02-product-requirements/Modules/Module_03_Gateway_and_Auth.md` |
| module-04 | `docs/02-product-requirements/Modules/Module_04_Custom_Discovery.md` |
| module-05 | `docs/02-product-requirements/Modules/Module_05_Custom_UI.md` |
| module-06 | `docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md` |
| module-07 | `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` |
| module-08 | `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md` |
| module-09 | `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md` |
| module-10 | `docs/02-product-requirements/Modules/Module_10_Monitoring_Source_Registry.md` |
