// Package resource implements Module 07 监控对象管理的支撑层：业务分组字典、
// 资源校验与查询辅助等。本文件提供 Excel 导入模板下载：按资源类型生成静态
// xlsx（sheet1 固定数据列 + 第 2 行示例数据 + sheet2「取值说明」），供前端
// 「下载模板」与 T07-09 Excel 解析复用。
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
// Module_07 §5.16.1（不支持动态列）。该定义同时供 T07-09 Excel 解析校验复用，
// 并作为 sheet2「取值说明」行序与列过滤的**唯一权威来源**（F-24）——
// 取值说明不得另立一份「类别 → 列」映射，避免新增漂移点。
//
// 决策 103 scheme-B：模板列头不含 `cloud_code`（资源侧不再经导入写 cloud_code，
// 统一由所属网域派生）；决策 101 后续：host 的 `zone_env` 兼容导入列**已废弃**，
// 模板不再输出该列——分区权威值为所属网域 `zone_type`，该列既不进标签也不作分区
// 权威，留着只会诱导填假值。存量 Excel 仍可能带该列，导入侧按列名静默忽略
// （见 excel.go 的 removedTemplateColumns），值不落库。
//
// 决策 D-7（P1）：五类列头**末尾**统一追加可选 `scrape_port` 列（实例级采集端口
// 覆盖，0=未指定）——一律追加末尾、不插中间，防列序依赖断裂；旧模板（无该列）导入
// 由 validateHeader 容缺，按 0 处理（见 excel.go）。
var TemplateColumns = map[models.ResourceCategory][]string{
	models.ResourceCategoryHost: {
		"network_domain", "instance_name", "hostname", "instance_ip", "os_type",
		"biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status",
		"scrape_port",
	},
	models.ResourceCategoryDatabase: {
		"network_domain", "database_type", "instance_ip", "port", "version",
		"biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status",
		"scrape_port",
	},
	models.ResourceCategoryMiddleware: {
		"network_domain", "middleware_type", "instance_ip", "port", "version",
		"biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status",
		"scrape_port",
	},
	models.ResourceCategoryApplication: {
		"network_domain", "service_name", "biz_code", "health_check_url", "protocol",
		"endpoint", "port", "app_code", "platform_code", "env", "cluster", "owner", "status",
		"scrape_port", "owner1", "owner1_contact", "owner2", "owner2_contact", "go_live_at",
	},
	models.ResourceCategoryGenericTarget: {
		"network_domain", "target_name", "instance_ip", "port", "metrics_path", "scheme",
		"exporter_type", "custom_labels", "biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status",
		"scrape_port",
	},
	// 第 6 类「接口服务」：类型专属字段 api_name / api_url + 公共字段
	// 网域/业务/应用/环境/运行状态；刻意不含 platform_code / cluster / owner。
	// env 必须保留：validateCommon 对全部类别强制 env ∈ ValidEnvs（OPS/PRD/UAT），
	// 模板缺该列会导致导入恒失败。
	// **不含 scrape_port**：拨测目标是完整 URL（端口已在 URL 内），该类别不存在
	// 「另有一个 exporter 采集端口」的语义 —— 是全类别里唯一不追加该尾列的。
	models.ResourceCategoryInterfaceService: {
		"network_domain", "api_name", "api_url", "biz_code", "app_code", "env", "status",
	},
}

// DomainOption 是「取值说明」sheet 中 network_domain 列的合法值条目
// （实时取自 M06 网域清单，ID 为 NetworkDomain 业务主键）。
type DomainOption struct {
	ID   string
	Name string
}

// templateColumnDoc 是模板列的静态说明：中文含义 + 静态格式提示。
//
// 中文含义对齐页面实际展示名（ui-custom/web/src/pages/resources/
// resourceColumnPrefs.ts 的列 label 与 ResourceFormDrawer.tsx 的表单项 label），
// 用于消除 sheet2 里「英文码看不懂」的失准（F-23-②）。
type templateColumnDoc struct {
	Label string // 中文含义
	Hint  string // 静态格式说明（字典实时值会追加在其后）
}

// templateColumnDocs 是全量列码的静态说明表。键集合必须覆盖 TemplateColumns
// 全部取值（由 TestTemplateColumnDocsCoverAllColumns 断言），新增列时漏登记会被
// 测试拦下。
var templateColumnDocs = map[string]templateColumnDoc{
	"network_domain":   {"网域", "网域 ID（实时取自已登记网域清单）"},
	"instance_name":    {"实例名", "实例名称；与 hostname 二选一即可"},
	"hostname":         {"主机名", "主机名（可选）"},
	"instance_ip":      {"IP 地址", "主机 / 数据库 / 中间件 / 应用须为 IPv4；其他监控目标可填 IPv4 或域名"},
	"os_type":          {"操作系统", "操作系统名称（采集按 Linux / Windows 家族匹配）"},
	"biz_code":         {"业务名称", "业务分组编码（仅小写字母、数字、连字符，≤64）"},
	"app_code":         {"应用名称", "应用编码（仅小写字母、数字、连字符，≤64）"},
	"platform_code":    {"平台", "平台编码（留空按所属应用主平台兜底）"},
	"env":              {"环境", "环境枚举"},
	"cluster":          {"集群", "集群名称"},
	"owner":            {"负责人", "负责人（自由文本）"},
	"owner1":           {"负责人1", "负责人1姓名（可选）"},
	"owner1_contact":   {"负责人1联系方式", "负责人1联系方式（可选）"},
	"owner2":           {"负责人2", "负责人2姓名（可选）"},
	"owner2_contact":   {"负责人2联系方式", "负责人2联系方式（可选）"},
	"go_live_at":       {"应用上线时间", "RFC3339 或 YYYY-MM-DD（可选）"},
	"status":           {"运行状态", "源状态 → 目标状态"},
	"scrape_port":      {"采集端口", "实例级采集端口覆盖：留空（0）=未指定，填值须 1~65535"},
	"database_type":    {"数据库类型", "数据库类型"},
	"middleware_type":  {"中间件类型", "中间件类型"},
	"port":             {"端口", "端口，1~65535"},
	"version":          {"版本", "版本号"},
	"service_name":     {"服务名", "应用服务名"},
	"health_check_url": {"健康检查 URL", "blackbox 拨测地址（必填），协议 http/https/tcp"},
	"protocol":         {"协议", "协议：http/https/tcp"},
	"endpoint":         {"端点", "应用采集地址主机（IPv4 或域名）"},
	"target_name":      {"目标名称", "监控目标名称"},
	"metrics_path":     {"采集路径", "采集路径，默认 /metrics"},
	"scheme":           {"协议", "协议：http/https"},
	"exporter_type":    {"Exporter 类型", "Exporter 类型，如 snmp_exporter / gpu_exporter / oracle_exporter"},
	"custom_labels":    {"自定义标签", "key1=value1;key2=value2"},
	"api_name":         {"接口名", "接口名称（展示名），≤200"},
	"api_url":          {"接口地址", "完整 URL（含 ? 查询参数），协议须为 http/https，如 https://api.example.com/health?token=xxx"},
}

// templateOptionalColumns 是**五类通用**的选填列（不随类别变化）。
var templateOptionalColumns = map[string]bool{
	"hostname": true, "version": true, "owner": true, "protocol": true,
	"metrics_path": true, "scheme": true,
	"exporter_type": true, "custom_labels": true, "scrape_port": true,
	"platform_code": true, "owner1": true, "owner1_contact": true,
	"owner2": true, "owner2_contact": true, "go_live_at": true,
}

// valueSheetHeaderRow 是 sheet2「取值说明」的表头行（F-23-② 拆出「中文含义」列、
// F-24 明确每列必填口径）。
var valueSheetHeaderRow = []string{"取值字段", "中文含义", "必填口径", "合法值 / 格式说明"}

// valueSheetNoteField / valueSheetNoteText 是 sheet2 顶部对示例行的提示行。
const (
	valueSheetNoteField = "（填写说明）"
	valueSheetNoteText  = "sheet1 第 2 行为示例行，导入前请删除"
	valueSheetNoteDesc  = "该行以浅色斜体底纹标注，仅演示各列填写格式；导入解析会自动跳过与示例行完全一致的数据行，不会写入资源"
)

// DownloadTemplate 返回 GET /api/v2/platform/resources/:type/template 的 handler：
//
//   - type ∈ host/database/middleware/application/generic_target：返回静态 xlsx 下载
//     （Content-Type spreadsheetml，文件名 `{type}_template.xlsx`），sheet1 为 §5.16.1
//     固定数据列 + **第 2 行示例数据行**（浅色底纹，F-23-①），sheet2「取值说明」按该类别
//     sheet1 实际拥有的列逐列输出（中文含义 / 必填口径 / 合法值，行序与 sheet1 列序
//     完全一致，F-24）。MVP 不做 dataValidation 下拉（挪 v0.2+ 评估）；
//   - 未知类型返回 not_found。
//
// 依赖通过函数注入以保持可测试性：bizStore 提供业务字典启用项（T07-02），appStore 提供
// 应用字典启用项（决策 92/96，F-7 ①：取值说明实时注入 app_code 可取值），listDomains
// 由调用方提供 M06 网域清单查询（T07-18 路由注册时注入 db 查询）。
func DownloadTemplate(bizStore *BusinessDomainStore, appStore *ApplicationDictStore, platformStore *PlatformDictStore, listDomains func() ([]DomainOption, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		typeName := c.Param("type")
		category := models.ResourceCategory(typeName)
		if _, ok := TemplateColumns[category]; !ok {
			response.NotFound(c, fmt.Sprintf("未知资源类型：%s，可选 %s", typeName, models.CategoriesHint()))
			return
		}

		valueRows, err := buildValueSheet(category, bizStore, appStore, platformStore, listDomains)
		if err != nil {
			response.InternalServerError(c, fmt.Errorf("生成「取值说明」失败：%w", err))
			return
		}

		data, err := buildTemplateXLSX(category, valueRows)
		if err != nil {
			response.InternalServerError(c, fmt.Errorf("生成 %s 导入模板失败：%w", typeName, err))
			return
		}

		c.Header("Content-Type", xlsxContentType)
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", typeName+"_template.xlsx"))
		c.Data(http.StatusOK, xlsxContentType, data)
	}
}

// buildValueSheet 组装「取值说明」sheet 的行（F-24）：
//
//   - 首行为表头「取值字段 / 中文含义 / 必填口径 / 合法值 / 格式说明」，第 2 行是
//     示例行提示（valueSheetNoteField / valueSheetNoteText）；
//   - 其后**逐列**输出该类别 sheet1 实际拥有的列，行序与 TemplateColumns[category]
//     完全一致（逐列对读），不存在其他类别独有的列（如 host 不出现 custom_labels）；
//   - 每行给出中文含义（对齐页面列名）与必填口径（必填 / 可留空 / 二选一）；
//   - 字典实时注入保留：network_domain（M06 网域清单）、biz_code / app_code /
//     platform_code（对应字典启用项，停用项不进入），且只对该类别
//     实际存在的列查询与输出。
func buildValueSheet(category models.ResourceCategory, bizStore *BusinessDomainStore, appStore *ApplicationDictStore, platformStore *PlatformDictStore, listDomains func() ([]DomainOption, error)) ([][]string, error) {
	columns := TemplateColumns[category]
	present := make(map[string]bool, len(columns))
	for _, col := range columns {
		present[col] = true
	}

	rows := make([][]string, 0, len(columns)+2)
	rows = append(rows, append([]string{}, valueSheetHeaderRow...))
	rows = append(rows, []string{valueSheetNoteField, valueSheetNoteText, "示例行", valueSheetNoteDesc})

	// liveDesc 收集字典实时取值；静态提示见 templateColumnDocs.Hint。
	liveDesc := make(map[string]string, len(columns))

	if present["network_domain"] {
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
		liveDesc["network_domain"] = strings.Join(domainDesc, "；")
	}

	if present["biz_code"] {
		// 业务分组字典启用项（infra 为强制兜底条目）；停用项不进入，PRD §3.1。
		bizList, err := bizStore.EnabledList()
		if err != nil {
			return nil, fmt.Errorf("读取业务分组字典失败：%w", err)
		}
		bizDesc := make([]string, 0, len(bizList))
		for _, b := range bizList {
			bizDesc = append(bizDesc, fmt.Sprintf("%s（%s）", b.Code, b.Name))
		}
		liveDesc["biz_code"] = strings.Join(bizDesc, "；")
	}

	if present["app_code"] {
		// 应用字典启用项（决策 92/96，F-7 ①：模板取值说明实时注入应用字典，
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
		liveDesc["app_code"] = strings.Join(appDesc, "；")
	}

	if present["platform_code"] {
		// 平台字典启用项（决策 110，可空列——留空时按所属应用主平台兜底；
		// 填值须为启用条目且与所属 app_code 的平台集合自洽，停用项不进入）。
		platformDesc := "可空列，留空按所属应用主平台兜底"
		if platformStore != nil {
			pfList, err := platformStore.EnabledList()
			if err != nil {
				return nil, fmt.Errorf("读取平台字典失败：%w", err)
			}
			items := make([]string, 0, len(pfList))
			for _, p := range pfList {
				items = append(items, fmt.Sprintf("%s（%s）", p.PlatformCode, p.PlatformName))
			}
			if len(items) > 0 {
				platformDesc += "；" + strings.Join(items, "；")
			}
		}
		liveDesc["platform_code"] = platformDesc
	}

	if present["env"] {
		liveDesc["env"] = strings.Join(models.ValidEnvs, "；")
	}

	if present["status"] {
		liveDesc["status"] = statusValueDescription()
	}

	for _, col := range columns {
		doc := templateColumnDocs[col]
		desc := doc.Hint
		if live, ok := liveDesc[col]; ok {
			if live != "" {
				desc += "；" + live
			}
		}
		rows = append(rows, []string{col, doc.Label, templateColumnRequiredLabel(category, col), desc})
	}

	return rows, nil
}

// templateColumnRequiredLabel 返回某列在某资源类别下的必填口径文案。
// 口径真值来自 excel.go 的必填分化（L267-L279）与 validate.go 的各 validate*
// 分派函数。cluster 的「host / generic_target 可空、application / database /
// middleware 必填」按 PRD §5.2 与 design-decisions 决策 F 的明文分化标注（chenrt 已
// 裁定「保持按类分化必填」，非待裁定项）；前端已在 M07 本轮同步补齐同一套按类分化
// 规则，此前「前端 cluster 选填 vs 后端判必填」的矛盾已消解。
func templateColumnRequiredLabel(category models.ResourceCategory, col string) string {
	switch col {
	case "network_domain":
		return "可留空（留空按 default 网域导入）"
	case "biz_code":
		switch category {
		case models.ResourceCategoryApplication, models.ResourceCategoryInterfaceService:
			return "必填"
		case models.ResourceCategoryGenericTarget:
			return "二选一（与 app_code 至少填一个）"
		default:
			return "可留空（留空后补）"
		}
	case "app_code":
		switch category {
		case models.ResourceCategoryDatabase, models.ResourceCategoryMiddleware,
			models.ResourceCategoryApplication, models.ResourceCategoryInterfaceService:
			return "必填"
		case models.ResourceCategoryGenericTarget:
			return "二选一（与 biz_code 至少填一个）"
		default:
			return "可留空"
		}
	case "cluster":
		switch category {
		case models.ResourceCategoryDatabase, models.ResourceCategoryMiddleware, models.ResourceCategoryApplication:
			return "必填"
		default:
			return "可留空"
		}
	case "endpoint":
		if category == models.ResourceCategoryApplication {
			return "可留空"
		}
	case "port":
		if category == models.ResourceCategoryGenericTarget || category == models.ResourceCategoryApplication {
			return "可留空"
		}
		return "必填（1~65535）"
	case "env":
		return "必填"
	case "status":
		return "可留空（留空按默认映射兜底为 offline）"
	case "instance_name":
		return "必填（与 hostname 二选一）"
	}
	if templateOptionalColumns[col] {
		return "可留空"
	}
	return "必填"
}

// templateExampleRow 返回该类别 sheet1 第 2 行的示例数据（F-23-①）。
//
// 构造口径（与 templateColumnRequiredLabel 同一份必填口径）：
//
//   - **必填列必须有值、选填列一律留空**，且示例值与该类别实际存在的列严格对齐
//     （按 TemplateColumns[category] 的列序取值，只登记必填列的值）；
//   - generic_target 的 app_code / biz_code 为「二选一」，示例行只填 biz_code 一侧、
//     app_code 留空，直观呈现最小满足形态；
//   - 易被误认为真实字典的编码/名称类字段统一带「示例」或 `example` 字样，IP 用
//     RFC 5737 文档保留段 192.0.2.0/24（实际网段不会出现），避免与真实资源混淆。
func templateExampleRow(category models.ResourceCategory) []string {
	values := map[string]string{"env": "PRD"}
	switch category {
	case models.ResourceCategoryHost:
		values["instance_name"] = "示例-web-01"
		values["instance_ip"] = "192.0.2.1"
		values["os_type"] = "Linux"
	case models.ResourceCategoryDatabase:
		values["database_type"] = "mysql"
		values["instance_ip"] = "192.0.2.2"
		values["port"] = "3306"
		values["app_code"] = "example-app"
		values["cluster"] = "示例-cluster"
	case models.ResourceCategoryMiddleware:
		values["middleware_type"] = "kafka"
		values["instance_ip"] = "192.0.2.3"
		values["port"] = "9092"
		values["app_code"] = "example-app"
		values["cluster"] = "示例-cluster"
	case models.ResourceCategoryApplication:
		values["service_name"] = "示例-pay-service"
		values["biz_code"] = "example-biz"
		values["health_check_url"] = "https://app.example.com/health"
		values["app_code"] = "example-app"
		values["cluster"] = "示例-cluster"
	case models.ResourceCategoryGenericTarget:
		values["target_name"] = "示例-snmp-switch-01"
		values["instance_ip"] = "192.0.2.30"
		values["biz_code"] = "example-biz"
	case models.ResourceCategoryInterfaceService:
		values["api_name"] = "示例-健康检查接口"
		values["api_url"] = "https://api.example.com/health"
		values["biz_code"] = "example-biz"
		values["app_code"] = "example-app"
	}
	columns := TemplateColumns[category]
	row := make([]string, len(columns))
	for i, col := range columns {
		row[i] = values[col]
	}
	return row
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

// buildTemplateXLSX 生成静态 xlsx：sheet1 写入固定列头 + 第 2 行示例数据行（浅色
// 斜体底纹标注为示例），sheet2「取值说明」写入提示行与逐列说明；打开时默认落在
// sheet1。MVP 不做 dataValidation 下拉（§5.16.1）。
//
// 列头与示例行均由 TemplateColumns[category] 推导，sheet2 由 buildValueSheet
// 按同一列序产出，三者不会漂移。
func buildTemplateXLSX(category models.ResourceCategory, valueRows [][]string) ([]byte, error) {
	columns := TemplateColumns[category]
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

	// sheet1 第 2 行：示例数据行（必填列有值、选填列留空），整行浅色斜体底纹标注
	// 为示例；导入侧 ParseExcel 会跳过与该行完全一致的数据行（F-23-① 防误导入）。
	for i, val := range templateExampleRow(category) {
		cell, err := excelize.CoordinatesToCellName(i+1, 2)
		if err != nil {
			return nil, fmt.Errorf("计算示例行单元格失败：%w", err)
		}
		if err := f.SetCellValue(sheet1, cell, val); err != nil {
			return nil, fmt.Errorf("写入示例行单元格失败：%w", err)
		}
	}
	exampleStyle, err := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Italic: true, Color: "808080"},
		Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"F2F2F2"}},
	})
	if err != nil {
		return nil, fmt.Errorf("创建示例行样式失败：%w", err)
	}
	firstCell, err := excelize.CoordinatesToCellName(1, 2)
	if err != nil {
		return nil, fmt.Errorf("计算示例行首单元格失败：%w", err)
	}
	lastCell, err := excelize.CoordinatesToCellName(len(columns), 2)
	if err != nil {
		return nil, fmt.Errorf("计算示例行末单元格失败：%w", err)
	}
	if err := f.SetCellStyle(sheet1, firstCell, lastCell, exampleStyle); err != nil {
		return nil, fmt.Errorf("设置示例行样式失败：%w", err)
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
