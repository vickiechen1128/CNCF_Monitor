// Package resource implements Module 07 监控对象管理的支撑层：业务分组字典、
// 资源校验与查询辅助等。本文件提供 Excel 导入模板下载：按资源类型生成静态
// xlsx（sheet1 固定数据列 + sheet2「取值说明」），供前端「下载模板」与
// T07-09 Excel 解析复用。
package resource

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/xuri/excelize/v2"
)

// xlsxContentType 是 OOXML 电子表格的 MIME 类型。
const xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

// TemplateColumns 定义五类资源 Excel 导入模板 sheet1 的固定列头，严格对齐
// Module_07 §5.16.1（不支持动态列）。该定义同时供 T07-09 Excel 解析校验复用。
//
// 决策 103 scheme-B：模板列头不含 `cloud_code`（资源侧不再经导入写 cloud_code，
// 统一由所属网域派生）；决策 101：host 另保留 `zone_env` **兼容导入列**（承接历史
// Excel，不进标签、不作分区权威）——列位置严格按 §5.16.1 主机模板列序排在 `cluster`
// 之后、`owner` 之前。
var TemplateColumns = map[models.ResourceCategory][]string{
	models.ResourceCategoryHost: {
		"network_domain", "instance_name", "hostname", "instance_ip", "os_type",
		"biz_code", "app_code", "env", "cluster", "zone_env", "owner", "status",
	},
	models.ResourceCategoryDatabase: {
		"network_domain", "database_type", "instance_ip", "port", "version",
		"biz_code", "app_code", "env", "cluster", "owner", "status",
	},
	models.ResourceCategoryMiddleware: {
		"network_domain", "middleware_type", "instance_ip", "port", "version",
		"biz_code", "app_code", "env", "cluster", "owner", "status",
	},
	models.ResourceCategoryApplication: {
		// 决策 105：service_code 为可选列，排在 service_name 之后（§5.16.1）。
		"network_domain", "service_name", "service_code", "biz_code", "health_check_url", "protocol",
		"endpoint", "port", "app_code", "env", "cluster", "owner", "status",
	},
	models.ResourceCategoryGenericTarget: {
		// 决策 105：service_code 为可选列（§5.16.1 其他监控目标列序）。
		"network_domain", "target_name", "instance_ip", "port", "metrics_path", "scheme",
		"exporter_type", "custom_labels", "service_code", "biz_code", "app_code", "env", "cluster", "owner", "status",
	},
}

// DomainOption 是「取值说明」sheet 中 network_domain 列的合法值条目
// （实时取自 M06 网域清单，ID 为 NetworkDomain 业务主键）。
type DomainOption struct {
	ID   string
	Name string
}

// DownloadTemplate 返回 GET /api/v2/platform/resources/:type/template 的 handler：
//
//   - type ∈ host/database/middleware/application/generic_target：返回静态 xlsx 下载
//     （Content-Type spreadsheetml，文件名 `{type}_template.xlsx`），sheet1 为 §5.16.1
//     固定数据列，sheet2「取值说明」列出 network_domain / zone_env / biz_code /
//     app_code / env / status / custom_labels 合法值（§5.16.1，MVP 不做
//     dataValidation 下拉，挪 v0.2+ 评估）；
//   - 未知类型返回 not_found。
//
// 依赖通过函数注入以保持可测试性：bizStore 提供业务字典启用项（T07-02），appStore 提供
// 应用字典启用项（决策 92/96，F-7 ①：取值说明实时注入 app_code 可取值），listDomains
// 由调用方提供 M06 网域清单查询（T07-18 路由注册时注入 db 查询）。
func DownloadTemplate(bizStore *BusinessDomainStore, appStore *ApplicationDictStore, svcStore *ServiceDictStore, listDomains func() ([]DomainOption, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		typeName := c.Param("type")
		category := models.ResourceCategory(typeName)
		columns, ok := TemplateColumns[category]
		if !ok {
			response.NotFound(c, fmt.Sprintf("未知资源类型：%s，可选 host/database/middleware/application/generic_target", typeName))
			return
		}

		valueRows, err := buildValueSheet(bizStore, appStore, svcStore, listDomains)
		if err != nil {
			response.InternalServerError(c, fmt.Errorf("生成「取值说明」失败：%w", err))
			return
		}

		data, err := buildTemplateXLSX(columns, valueRows)
		if err != nil {
			response.InternalServerError(c, fmt.Errorf("生成 %s 导入模板失败：%w", typeName, err))
			return
		}

		c.Header("Content-Type", xlsxContentType)
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", typeName+"_template.xlsx"))
		c.Data(http.StatusOK, xlsxContentType, data)
	}
}

// buildValueSheet 组装「取值说明」sheet 的行：network_domain（M06 网域清单，实时）、
// zone_env（host 兼容导入列取值提示，决策 101）、biz_code（业务字典启用项，停用项
// 不进入，PRD §3.1）、app_code（应用字典启用项，决策 92/96，F-7 ①：与 biz_code
// 同构 `code（名称）`，空字典输出占位）、env 枚举、status 中文取值（§5.5.1 默认
// 映射）、custom_labels 格式说明。
func buildValueSheet(bizStore *BusinessDomainStore, appStore *ApplicationDictStore, svcStore *ServiceDictStore, listDomains func() ([]DomainOption, error)) ([][]string, error) {
	rows := [][]string{
		{"取值字段", "合法值 / 格式说明"},
	}

	// network_domain：实时取自 M06 网域清单（default 为历史预置管理网域）。
	var domains []DomainOption
	if listDomains != nil {
		var err error
		domains, err = listDomains()
		if err != nil {
			return nil, fmt.Errorf("读取网域清单失败：%w", err)
		}
	}
	domainDesc := make([]string, 0, len(domains))
	for _, d := range domains {
		if d.Name != "" {
			domainDesc = append(domainDesc, fmt.Sprintf("%s（%s）", d.ID, d.Name))
		} else {
			domainDesc = append(domainDesc, d.ID)
		}
	}
	rows = append(rows, []string{"network_domain", strings.Join(domainDesc, "；")})

	// cloud_code / zone：决策 103 scheme-B，资源侧不再持有 cloud_code 写路径，统一经
	// 所属网域（network_domain_id）派生 cloud（= 网域 cloud_code）/ zone（= 网域
	// zone_type）标签，故模板取值说明不再单独列出 cloud_code 列。

	// zone_env：仅 host 模板存在的兼容导入列（决策 101 / §5.6）——不进标签、不作
	// 分区权威，左侧 INT / GOV 与 zone_type 展示名仅为填写提示。
	rows = append(rows, []string{"zone_env", "INT（互联网区 internet）/ GOV（政务外网区 extranet）；仅主机兼容导入列，不进标签、不作分区权威（权威值为所属网域 zone_type）"})

	// biz_code：业务分组字典启用项（infra 为强制兜底条目）。
	bizList, err := bizStore.EnabledList()
	if err != nil {
		return nil, fmt.Errorf("读取业务分组字典失败：%w", err)
	}
	bizDesc := make([]string, 0, len(bizList))
	for _, b := range bizList {
		bizDesc = append(bizDesc, fmt.Sprintf("%s（%s）", b.Code, b.Name))
	}
	rows = append(rows, []string{"biz_code", strings.Join(bizDesc, "；")})

	// app_code：应用字典启用项（决策 92/96，F-7 ①：模板取值说明实时注入应用字典，
	// 与 biz_code 同构 `code（名称）`；停用项不进入，空字典输出占位引导）。
	appList, err := appStore.EnabledList()
	if err != nil {
		return nil, fmt.Errorf("读取应用字典失败：%w", err)
	}
	appDesc := make([]string, 0, len(appList))
	for _, a := range appList {
		appDesc = append(appDesc, fmt.Sprintf("%s（%s）", a.AppCode, a.AppName))
	}
	if len(appDesc) == 0 {
		appDesc = append(appDesc, "暂无已登记应用")
	}
	rows = append(rows, []string{"app_code", strings.Join(appDesc, "；")})

	// service_code：服务字典启用项（决策 105，可选列的合法取值；与 app_code 同构
	// `code（名称）`，停用项不进入）。
	svcDesc := []string{"可选列，留空不填"}
	if svcStore != nil {
		svcList, err := svcStore.EnabledList()
		if err != nil {
			return nil, fmt.Errorf("读取服务字典失败：%w", err)
		}
		items := make([]string, 0, len(svcList))
		for _, s := range svcList {
			items = append(items, fmt.Sprintf("%s（%s）", s.ServiceCode, s.ServiceName))
		}
		if len(items) > 0 {
			svcDesc = append(svcDesc, "；"+strings.Join(items, "；"))
		}
	}
	rows = append(rows, []string{"service_code", strings.Join(svcDesc, "")})

	rows = append(rows, []string{"env", strings.Join(models.ValidEnvs, "；")})
	rows = append(rows, []string{"status", statusValueDescription()})
	rows = append(rows, []string{"custom_labels", "key1=value1;key2=value2（仅通用指标目标列）"})

	return rows, nil
}

// statusValueDescription 汇总 status 列的中文取值与目标状态映射
// （来源 models.DefaultStatusMappings，§5.5.1 默认映射，Excel 导入经其转换）。
func statusValueDescription() string {
	parts := make([]string, 0, len(models.DefaultStatusMappings()))
	for _, m := range models.DefaultStatusMappings() {
		parts = append(parts, fmt.Sprintf("%s → %s", m.SourceStatus, m.TargetStatus))
	}
	return strings.Join(parts, "；")
}

// buildTemplateXLSX 生成静态 xlsx：sheet1 写入固定列头，sheet2「取值说明」写入
// 合法值行；打开时默认落在 sheet1。MVP 不做 dataValidation 下拉（§5.16.1）。
func buildTemplateXLSX(columns []string, valueRows [][]string) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()

	// sheet1 数据列头。
	sheet1 := f.GetSheetName(0)
	for i, col := range columns {
		cell, err := excelize.CoordinatesToCellName(i+1, 1)
		if err != nil {
			return nil, fmt.Errorf("计算表头单元格失败：%w", err)
		}
		if err := f.SetCellValue(sheet1, cell, col); err != nil {
			return nil, fmt.Errorf("写入 %s 列头失败：%w", col, err)
		}
	}

	// sheet2 取值说明。
	sheet2 := "取值说明"
	if _, err := f.NewSheet(sheet2); err != nil {
		return nil, fmt.Errorf("创建「取值说明」sheet 失败：%w", err)
	}
	for r, row := range valueRows {
		for c, val := range row {
			cell, err := excelize.CoordinatesToCellName(c+1, r+1)
			if err != nil {
				return nil, fmt.Errorf("计算取值说明单元格失败：%w", err)
			}
			if err := f.SetCellValue(sheet2, cell, val); err != nil {
				return nil, fmt.Errorf("写入取值说明单元格失败：%w", err)
			}
		}
	}

	f.SetActiveSheet(0)

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, fmt.Errorf("写出 xlsx 失败：%w", err)
	}
	return buf.Bytes(), nil
}
