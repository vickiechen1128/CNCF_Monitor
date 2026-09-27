# 云主机资源清单 - Excel 模板规范

> 本文档对应 Excel 模板：`assets/templates/excel/host_template.xlsx`  
> 用途：定义 MetricCenter 主机资源导入的字段规范、数据字典及示例数据  
> 版本：v1.3  
> 更新日期：2026-09-27

---

## 一、字段定义

| 序号 | 字段名（中文）   | 建议字段名（英文）        | 数据类型         | 是否必填  | 说明                           |
| :- | :-------- | :--------------- | :----------- | :---- | :--------------------------- |
| 1  | 所属网域     | network_domain_id | VARCHAR(64)  | 否     | 网域 ID；MVP 留空时系统默认填 `default`；v0.2+ 按租户上下文自动填充 |
| 2  | 所属云代码（v1.3 已移除） | cloud_code       | —            | —     | **v1.3 移除（决策 103 scheme-B 实体模型收敛）**：云归属上提为网域行政字段（网域登记必填、引用云字典启用条目，Module_06 §5），主机侧不再提供该导入列、填了也忽略；生成 `cloud` label 的责任改由采集目标按所属网域 `cloud_code` 派生，在配置产物 target 级 system 层强制注入（不进 Excel、不进 LabelTemplate 默认映射） |
| 3  | 应用代码      | app_code         | VARCHAR(100) | **是** | 所属应用编码；生成 `app` label            |
| 4  | 集群代码     | sub_app_code     | VARCHAR(100) | 否     | **集群编码**（即 `cluster` label 来源；列名沿用 CMDB 历史命名 `sub_app_code`，**语义为集群、不是子应用**）；未填时取 `vpc` 列 |
| 5  | 环境标识      | env_flag         | VARCHAR(20)  | **是** | 环境标识：`SIT` / `PRD`；生成 `env` label |
| 6  | 服务器ID     | server_id        | VARCHAR(64)  | 否     | 云平台分配的服务器唯一ID；`resource_id` 优先取该字段；缺失时 fallback 到 `instance_name` |
| 7  | 实例名称      | instance_name    | VARCHAR(200) | **是** | 实例命名，遵循命名规范；同时作为 `hostname` label |
| 8  | 状态        | status           | VARCHAR(20)  | **是** | 实例状态，如 `运行中` / `已停止`；导入时映射到 `Resource.status` |
| 9  | 地域/可用区    | region           | VARCHAR(50)  | 否     | 如：`上海`                       |
| 10 | 区域-环境     | zone_env         | VARCHAR(20)  | 否     | **兼容导入列**（非分区权威值）：`INT`（互联网区，映射 `zone_type` = `internet`）/ `GOV`（政务外网区，映射 `zone_type` = `extranet`）；分区权威值见所属网域 `zone_type`（见 §2.2） |
| 11 | 实例规格      | instance_spec    | VARCHAR(50)  | 否     | 如：`S9.LARGE8`、`S9.2XLARGE16` |
| 12 | vCPU      | vcpu             | INT          | 否     | CPU 核数                       |
| 13 | 内存(GB)    | memory_gb        | INT          | 否     | 内存大小，单位 GB                   |
| 14 | 镜像        | image            | VARCHAR(200) | 否     | 操作系统镜像名称；生成 `os_type` label    |
| 15 | 系统盘(GB)   | system_disk_gb   | INT          | 否     | 系统盘大小，单位 GB                  |
| 16 | 数据盘(GB)   | data_disk_gb     | INT          | 否     | 数据盘大小，单位 GB                  |
| 17 | 公网IP      | public_ip        | VARCHAR(50)  | 否     | 公网 IP 地址                     |
| 18 | 带宽(Mbps)  | bandwidth        | INT          | 否     | 公网带宽，单位 Mbps                 |
| 19 | 私网网段      | private_subnet   | VARCHAR(50)  | 否     | 私网 CIDR 网段                   |
| 20 | 私网IP      | private_ip       | VARCHAR(50)  | **是** | 私网 IP 地址；作为采集目标地址            |
| 21 | 机器用途      | purpose          | VARCHAR(200) | 否     | 服务器用途描述                      |
| 22 | VPC       | vpc              | VARCHAR(100) | **是** | 所属 VPC 名称；`sub_app_code` 为空时作为 `cluster` label |
| 23 | 安全组       | security_group   | VARCHAR(100) | 否     | 所属安全组名称                      |
| 24 | 创建时间(UTC) | created_at       | DATETIME     | 否     | 实例创建时间                       |
| 25 | 到期时间      | expired_at       | DATETIME     | 否     | 实例到期时间（按量付费可为空）              |
| 26 | CMDB CI ID  | cmdb_ci_id       | VARCHAR(64)  | 否     | {v0.4+} 对应 BlueKing CMDB CI ID；CMDB 接入后由系统自动填充 |
| 27 | CMDB 业务路径 | cmdb_business_path | VARCHAR(255) | 否     | {v0.4+} 对应 BlueKing CMDB 业务路径     |
| 28 | CMDB 模块路径 | cmdb_module_path | VARCHAR(255) | 否     | {v0.4+} 对应 BlueKing CMDB 模块路径     |
| 29 | CMDB 维护人  | cmdb_maintainer  | VARCHAR(100) | 否     | {v0.4+} 对应 BlueKing CMDB 维护人       |

> **字段分层说明**：
> - **必填**：资源识别、采集目标、核心 Label 生成所必需。
> - **可选**：CMDB/云平台元数据，用于展示、筛选和未来 CMDB 对齐；MVP 阶段可不填。
> - **{v0.4+}**：仅在外部 CMDB 接入后使用；MVP 导入时预留为空，用于提前教育用户建立 CMDB 字段意识。
>
> **云标识取值与历史值归一（决策 98 / 决策 103 scheme-B）**：云字典（`cloud_code` 复合码 `{类型}-{载体}`）仍**随部署预置、全局只读、无任何管理界面**（对齐 `zone_type` 字典先例），但**消费方由资源侧改为 Module_06 网域登记**——网域登记时 `cloud_code` 必填且须为云字典启用条目（未启用项拒绝登记），不再由主机 Excel 导入写入。历史归一映射保留参考：`TX → PUB-TX`（腾讯云）、`CU → GM-CU`（政务云 · 联通），`CM` 暂不登记；其余非字典值（含历史上传 Excel 里的裸值）在网域登记环节即被拦截，不会流入资源侧。

---

## 二、枚举值 / 数据字典

### 2.1 环境标识（env_flag）

| 值   | 说明   |
| :-- | :--- |
| SIT | 测试环境 |
| PRD | 生产环境 |

### 2.2 区域-环境（zone_env）

> **兼容导入列（决策 99）**：`zone_env` 仅为承接历史 Excel / CMDB 数据的**兼容导入列**——不进新增 UI、不进标签、**不作分区权威值**；网络分区的唯一权威是所属网域的 `zone_type`（网域登记 · Module_06），主机侧只读派生展示。

| 值   | 说明   |
| :-- | :--- |
| INT | 互联网区（映射 `zone_type` = `internet`） |
| GOV | 政务外网区（映射 `zone_type` = `extranet`） |

### 2.3 实例状态（status）

| 值   | 说明   |
| :-- | :--- |
| 运行中 | 正常运行 |
| 已停止 | 已关机  |

### 2.4 镜像类型（image）

| 值                                 | 说明           |
| :-------------------------------- | :----------- |
| Ubuntu Server 22.04 LTS 64位       | Linux（腾讯云）   |
| Ubuntu Server 24.04 LTS 64位       | Linux（腾讯云）   |
| Windows Server 2025 数据中心版 64位 中文版 | Windows（腾讯云） |
| 鲲鹏麒麟V10SP3                        | 国产信创（联通云）    |

---

## 三、示例数据

### 3.1 腾讯云 - 数据计算（SJJS）- SIT 环境

| 实例名称                                       | 规格         | vCPU | 内存  | 镜像              | 系统盘  | 数据盘  | VPC                                    | 安全组                        |
| :----------------------------------------- | :--------- | :--- | :-- | :-------------- | :--- | :--- | :------------------------------------- | :------------------------- |
| V_TX_SH02_GGSQ_SJJS_SIT_WEB_01_X86 | S9.LARGE8  | 4    | 8G  | Ubuntu 22.04    | 100G | 100G | TX_SH02_vpc_SJJS_SIT_010010001/24 | TX_SH02_sg_WEB_SIT_01 |
| V_TX_SH02_GGSQ_SJJS_SIT_WEB_02_X86 | S9.LARGE8  | 4    | 8G  | Win Server 2025 | 100G | 100G | TX_SH02_vpc_SJJS_SIT_010010001/24 | TX_SH02_sg_WEB_SIT_01 |
| V_TX_SH02_GGSQ_SJJS_SIT_DB_01_X86  | S9.LARGE16 | 4    | 16G | Ubuntu 22.04    | 100G | 500G | TX_SH02_vpc_SJJS_SIT_010010001/24 | TX_SH02_sg_DB_SIT_01  |
| V_TX_SH02_GGSQ_SJJS_SIT_ES_01_X86  | S9.LARGE8  | 4    | 8G  | Ubuntu 22.04    | 100G | 300G | TX_SH02_vpc_SJJS_SIT_010010001/24 | TX_SH02_sg_DB_SIT_01  |

### 3.2 腾讯云 - 数据计算（SJJS）- PRD 环境

| 实例名称                                       | 规格         | vCPU | 内存  | 镜像              | 系统盘  | 数据盘  | VPC                                    | 安全组                        |
| :----------------------------------------- | :--------- | :--- | :-- | :-------------- | :--- | :--- | :------------------------------------- | :------------------------- |
| V_TX_SH02_GGSQ_SJJS_PRD_WEB_01_X86 | S9.LARGE8  | 4    | 8G  | Ubuntu 22.04    | 100G | 100G | TX_SH02_vpc_SJJS_PRD_172016000/22 | TX_SH02_sg_WEB_PRD_01 |
| V_TX_SH02_GGSQ_SJJS_PRD_WEB_02_X86 | S9.LARGE8  | 4    | 8G  | Win Server 2025 | 100G | 100G | TX_SH02_vpc_SJJS_PRD_172016000/22 | TX_SH02_sg_WEB_PRD_01 |
| V_TX_SH02_GGSQ_SJJS_PRD_DB_01_X86  | S9.LARGE16 | 4    | 16G | Ubuntu 22.04    | 100G | 500G | TX_SH02_vpc_SJJS_PRD_172016000/22 | TX_SH02_sg_DB_PRD_01  |
| V_TX_SH02_GGSQ_SJJS_PRD_ES_01_X86  | S9.LARGE8  | 4    | 8G  | Ubuntu 22.04    | 100G | 300G | TX_SH02_vpc_SJJS_PRD_172016000/22 | TX_SH02_sg_DB_PRD_01  |

---

## 四、命名规范

实例名称遵循如下规则：

```
V_{云代码}_{地域}_{项目缩写}_{子项目}_{环境}_{角色}_{序号}_{架构}
```

示例：`V_TX_SH02_GGSQ_SJJS_SIT_WEB_01_X86`

| 段                   | 含义         | 示例           |
| :------------------ | :--------- | :----------- |
| V                   | 虚拟机标识      | V            |
| TX / CU             | 云厂商（腾讯/联通） | TX           |
| SH02                | 地域编码（上海02） | SH02         |
| GGSQ                | 项目缩写       | GGSQ         |
| SJJS / YD2 / GL     | 子项目        | SJJS         |
| SIT / PRD           | 环境         | PRD          |
| WEB / DB / ES / APP | 角色         | WEB          |
| 01 / 02             | 序号         | 01           |
| X86 / KP            | CPU架构      | X86 / KP（鲲鹏） |

---

## 五、与 MetricCenter 数据模型的映射

MetricCenter 主机资源表需要至少包含以下核心字段，用于生成 Prometheus Label：

| MetricCenter 字段 | Excel 字段      | 说明                  |
| :---------------- | :------------- | :------------------ |
| network_domain_id | network_domain_id | MVP 留空默认 `default`；v0.2+ 按租户上下文填充 |
| resource_id       | server_id / instance_name | 唯一标识，优先 `server_id`；缺失时 fallback 到 `instance_name` |
| resource_type     | 固定值 `host`   | 资源类型              |
| app_name          | app_code       | 应用名 → `app` label  |
| env               | env_flag       | 环境 → `env` label    |
| cluster           | sub_app_code / vpc | **集群** → `cluster` label（列名 `sub_app_code` 为 CMDB 历史命名，语义 = 集群，不承载子应用）；`sub_app_code` 为空时取 `vpc` |
| instance_ip       | private_ip     | 实例 IP / 采集目标地址 |
| hostname          | instance_name  | 主机名                |
| os_type           | image          | 操作系统类型           |
| cloud_code        | （不来自 Excel） | 云标识 → `cloud` label：值取自所属网域 `cloud_code`（网域登记引用云字典启用条目），经采集目标 target 级 system 层注入；**不由 Excel 导入**，模板无此列（决策 103 scheme-B） |
| cmdb_ci_id        | cmdb_ci_id     | {v0.4+} CMDB CI ID    |
| cmdb_business_path | cmdb_business_path | {v0.4+} 业务路径      |
| cmdb_module_path  | cmdb_module_path | {v0.4+} 模块路径      |
| cmdb_maintainer   | cmdb_maintainer | {v0.4+} 维护人        |

> **LabelTemplate 决定最终输出**：Excel 字段只是候选来源，只有被 LabelTemplate 选中的字段才会实际写入 `prometheus.yml` 的 target label。注意：`cloud` / `zone` / `network_domain` 三类标签**不**经 LabelTemplate 默认映射，而由采集目标（config-center 生成器）按所属网域在 target 级 system 层强制注入（决策 103 scheme-B），故主机 Excel 不提供这些列。
> 其他字段（如规格、磁盘、带宽、安全组等）作为资源的元数据存储，用于展示和筛选，不直接生成 Label。
