# 云主机资源清单 - Excel 模板规范

> 本文档对应 Excel 模板：`assets/templates/excel/host_template.xlsx`  
> 用途：定义 MetricCenter 主机资源导入的字段规范、数据字典及示例数据  
> 版本：v1.0  
> 更新日期：2026-07-20

---

## 一、字段定义

| 序号 | 字段名（中文）   | 建议字段名（英文）        | 数据类型         | 是否必填  | 说明                           |
| :- | :-------- | :--------------- | :----------- | :---- | :--------------------------- |
| 1  | 所属云代码     | cloud_code       | VARCHAR(50)  | 否     | 云厂商标识，如 `YD_CU`（移动/联通）       |
| 2  | 应用代码      | app_code         | VARCHAR(100) | 否     | 所属应用编码                       |
| 3  | 子应用代码     | sub_app_code     | VARCHAR(100) | 否     | 子应用编码                        |
| 4  | 环境标识      | env_flag         | VARCHAR(20)  | 否     | 环境标识：`SIT` / `PRD`           |
| 5  | 服务器ID     | server_id        | VARCHAR(64)  | 否     | 云平台分配的服务器唯一ID                |
| 6  | 实例名称      | instance_name    | VARCHAR(200) | **是** | 实例命名，遵循命名规范                  |
| 7  | 状态        | status           | VARCHAR(20)  | 是     | 实例状态：`运行中` / `已停止` 等         |
| 8  | 地域/可用区    | region           | VARCHAR(50)  | 是     | 如：`上海`                       |
| 9  | 区域-环境     | zone_env         | VARCHAR(20)  | 是     | 网络区域：`INT`（互联网）/ `GOV`（政务网）  |
| 10 | 实例规格      | instance_spec    | VARCHAR(50)  | 是     | 如：`S9.LARGE8`、`S9.2XLARGE16` |
| 11 | vCPU      | vcpu             | INT          | 是     | CPU 核数                       |
| 12 | 内存(GB)    | memory_gb        | INT          | 是     | 内存大小，单位 GB                   |
| 13 | 镜像        | image            | VARCHAR(200) | 是     | 操作系统镜像名称                     |
| 14 | 系统盘(GB)   | system_disk_gb   | INT          | 是     | 系统盘大小，单位 GB                  |
| 15 | 数据盘(GB)   | data_disk_gb     | INT          | 否     | 数据盘大小，单位 GB                  |
| 16 | 公网IP      | public_ip        | VARCHAR(50)  | 否     | 公网 IP 地址                     |
| 17 | 带宽(Mbps)  | bandwidth        | INT          | 否     | 公网带宽，单位 Mbps                 |
| 18 | 私网网段      | private_subnet   | VARCHAR(50)  | 否     | 私网 CIDR 网段                   |
| 19 | 私网IP      | private_ip       | VARCHAR(50)  | 否     | 私网 IP 地址                     |
| 20 | 机器用途      | purpose          | VARCHAR(200) | 否     | 服务器用途描述                      |
| 21 | VPC       | vpc              | VARCHAR(100) | 是     | 所属 VPC 名称                    |
| 22 | 安全组       | security_group   | VARCHAR(100) | 是     | 所属安全组名称                      |
| 23 | 创建时间(UTC) | created_at       | DATETIME     | 否     | 实例创建时间                       |
| 24 | 到期时间      | expired_at       | DATETIME     | 否     | 实例到期时间（按量付费可为空）              |

---

## 二、枚举值 / 数据字典

### 2.1 环境标识（env_flag）

| 值   | 说明   |
| :-- | :--- |
| SIT | 测试环境 |
| PRD | 生产环境 |

### 2.2 区域-环境（zone_env）

| 值   | 说明   |
| :-- | :--- |
| INT | 互联网区 |
| GOV | 政务网区 |

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
| resource_id       | server_id / instance_name | 唯一标识，优先 server_id |
| resource_type     | 固定值 `host`   | 资源类型              |
| app_name          | app_code       | 应用名 → `app` label  |
| env               | env_flag       | 环境 → `env` label    |
| cluster           | sub_app_code / vpc | 集群/子应用 → `cluster` label |
| instance_ip       | private_ip     | 实例 IP               |
| hostname          | instance_name  | 主机名                |
| os_type           | image          | 操作系统类型           |

> 其他字段（如规格、磁盘、带宽）作为资源的元数据存储，用于展示和筛选，不直接生成 Label。
