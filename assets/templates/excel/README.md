# Excel 模板目录

本目录存放 MetricCenter 资源导入所用的 Excel 模板规范与示例文件。

## 目录结构

```
assets/templates/excel/
├── README.md              # 本说明
├── host_template.md       # 云主机资源导入规范（Markdown 版）
└── host_template.xlsx     # 云主机资源导入模板（Excel 版，待生成）
```

## 模板类型规划

| 资源类型 | Markdown 规范 | Excel 模板 | 说明 |
| :------ | :----------- | :--------- | :--- |
| 主机（Host） | `host_template.md` | `host_template.xlsx` | 云主机、物理机等计算资源 |
| 中间件（Middleware） | 待补充 | `middleware_template.xlsx` | MySQL、Redis、Kafka 等 |
| 应用服务（Application） | 待补充 | `application_template.xlsx` | 业务应用服务、拨测目标 |

## 使用方式

1. 前端页面提供模板下载入口，用户下载对应 `.xlsx` 文件。
2. 用户按规范填写后上传，后端 `platform/config/resource/excel.go` 按固定列名解析并校验。
3. Markdown 规范作为开发文档，描述字段定义、枚举值、校验规则。

## 字段冻结原则

MVP 阶段 Excel 模板采用**固定列名**，不支持动态字段映射。新增字段需：

1. 更新本目录下的 Markdown 规范
2. 更新后端模型与 Excel 解析逻辑
3. 重新生成 `.xlsx` 模板文件
