# M09 边缘采集节点安装指引 / 打包脚本：补齐服务环境变量配置

> 状态：done ｜ 关联：dev-feedback F-5（module-11）同类问题在 v2.0/m09 的收口
> 触发反馈：用户安装采集节点时，网域指引中的「服务配置」文件遗漏必须的环境变量信息；
> 临时解法是让用户自行编辑 `/opt/apps/edge-sync-agent/env/edge-sync-agent.env` 写入全量变量。

## 根因

`platform/edge-sync-agent/cmd/edge-sync-agent/probe.go:79-80` 中
`EDGE_COLLECTOR_BIN`/`EDGE_BLACKBOX_BIN` 默认值为 `vmagent`/`blackbox_exporter`（走 PATH）。
但离线包 `scripts/package-edge-agent.sh` 打入的是带 arch 后缀、且不在 PATH 的
`bin/vmagent-linux-amd64`、`bin/blackbox_exporter-linux-amd64`。

而此前产品侧三处「服务配置」只要求填 3 个必填 + 数据目录：

- Web 安装指引「启动/守护」步（`ui-custom/web/src/pages/config-center/domains/NetworkDomainsPage.tsx`）；
- systemd unit（`platform/edge-sync-agent/packaging/edge-sync-agent.service`，bin 路径注释默认走 PATH）；
- 包内 README（`platform/edge-sync-agent/packaging/README.md`，bin 路径默认仍写 PATH）。

结果用户按指引配置后 Agent 本体可起、但拉不起 vmagent/blackbox 子进程（找不到二进制），
只能手工把 10~11 个变量塞进 `env/edge-sync-agent.env`。完整变量清单仅散落在跨主机 E2E
文档 `edge-agent-cross-host-e2e.md:197-211` 的 drop-in，产品指引/包内未暴露。

## 修复（env 文件方案，文档单一来源）

统一由「包内自带的服务环境配置文件」承载全量变量，unit 通过 `EnvironmentFile=` 加载；
所有指引改为"编辑这一个文件 + 填三项必填"，从而结构性杜绝遗漏。

1. 新增 `platform/edge-sync-agent/packaging/env/edge-sync-agent.env`（单一源）：
   三项必填留空占位；其余给出推荐值——arch 后缀二进制路径、可写数据目录 `/opt/data`、
   回环端口（含 `EDGE_PROM_HEALTH_URL` 端口一致性提醒）；`EDGE_AGENT_VERSION=__VERSION__` 由打包注入。
2. `platform/edge-sync-agent/packaging/edge-sync-agent.service`：内联 `Environment=` 全量替换为
   `EnvironmentFile=/opt/apps/edge-sync-agent/env/edge-sync-agent.env`，顶部安装步骤补"编辑 env 文件"。
3. `scripts/package-edge-agent.sh`：打包布局新增 `env/`；存在性检查、拷贝、`__VERSION__` 注入与
   残留自检均纳入 env 文件；`start.sh` heredoc 引导改为指向 env 文件。
4. `platform/edge-sync-agent/packaging/README.md`：部署段落改为编辑 env 文件；补 `env/` 目录说明；
   可选变量表 bin 默认值更正为包内 `bin/vmagent-linux-<arch>`（非 PATH）。
5. Web 安装指引：新增可复制完整块 `EDGE_ENV_TEMPLATE`，「启动/守护」步展示全量变量（含三项必填
   占位、arch 后缀 bin 路径、数据目录与端口提醒），unit 安装命令仍保留。
6. 后端 `platform/modules/m09/service/onboarding_service.go` `defaultInstallGuide()` 第 3 步文案对齐
   "编辑 env/edge-sync-agent.env 填入网域 ID、接入 Token 与中心地址（其余变量已给推荐值）"；
   契约快照 §2.3 同步。

## 验证

- 后端：`go test ./platform/modules/m09/service/...`（新增断言：指引步骤指向 env 文件）。
- 前端：新增 `NetworkDomainsPage` 测试，展开安装指引后断言 env 块含三项必填 + arch 后缀 bin 路径 + 数据目录/端口。
- 打包：`bash scripts/package-edge-agent.sh` 产物应含 `env/edge-sync-agent.env`，且无残留 `__VERSION__`。
  （需先 `make build-edge-agent && make build-vmagent && make build-blackbox-edge` 备齐六个二进制。）
