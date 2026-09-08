// Package resource implements Module 07 监控对象管理的支撑层。本文件提供 Excel
// 导入的解析与行级校验：ParseExcel 按固定列模板（§5.16.1，对齐 T07-08
// TemplateColumns）读取 sheet1 生成 ImportRow；ValidateImportRow 逐行校验
// （§5.16.2 必填/网域/业务/IP/端口/URL/枚举/custom_labels），经 T07-04 MapStatus
// 把中文状态映射为枚举并生成 T07-03 DedupKey 判重键；ValidateRows 汇总合法行与
// 错误明细（§5.16.3 结构），供 T07-10 导入执行复用。本文件只含解析/校验纯函数，
// 不注册路由（T07-18 收口）。
package resource

import (
	"bytes"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/xuri/excelize/v2"
)

// ImportRow 是 Excel 的一行数据（Row 从 2 起始，即表头后第一行，§5.16.3）。
// ParseExcel 只做解析（保留原始文本）；ValidateImportRow 填充 Status（映射后
// 枚举）、DedupKey（T07-03 判重键）并解析 CustomLabels。
type ImportRow struct {
	Row             int
	Category        models.ResourceCategory
	Input           ResourceInput
	PortRaw         string // 原始 port 单元格文本（非数字时用于错误报告）
	CustomLabelsRaw string // 原始 custom_labels 单元格文本
	Status          models.ResourceStatus
	DedupKey        string
}

// ImportRowError 是行级校验失败的结构化错误，Detail 对齐 Module_07 §5.16.3
// 错误项（row/resource_category/field/value/reason），导入执行层（T07-10）经
// errors.As 取回 Detail 直接落入 ImportRecord.errors。
type ImportRowError struct {
	Detail models.ImportErrorDetail
}

// Error 实现 error 接口。
func (e *ImportRowError) Error() string {
	return fmt.Sprintf("第 %d 行 %s.%s=%q：%s",
		e.Detail.Row, e.Detail.ResourceCategory, e.Detail.Field, e.Detail.Value, e.Detail.Reason)
}

// ParseExcel 解析上传的 Excel 字节（.xlsx）：读取 sheet1 首行表头并与该类型固定
// 列模板（TemplateColumns，§5.16.1）逐列比对，列缺失/列名不符/多余列均返回错误
// （handler 包装为 bad_request，不支持动态列）；随后按表头把每行映射为 ImportRow
// （原始文本，含 Row 行号）。不执行行级校验——调用方需对每行调用
// ValidateImportRow。未知资源类型返回错误。
func ParseExcel(fileBytes []byte, category models.ResourceCategory) ([]ImportRow, error) {
	expected, ok := TemplateColumns[category]
	if !ok {
		return nil, fmt.Errorf("未知资源类型：%s，可选 host/database/middleware/application/generic_target", category)
	}

	f, err := excelize.OpenReader(bytes.NewReader(fileBytes))
	if err != nil {
		return nil, fmt.Errorf("无法解析 Excel 文件，请上传 .xlsx 模板：%w", err)
	}
	defer f.Close()

	sheet := f.GetSheetName(0)
	if sheet == "" {
		return nil, fmt.Errorf("Excel 文件缺少工作表")
	}
	rows, err := f.GetRows(sheet)
	if err != nil {
		return nil, fmt.Errorf("读取工作表失败：%w", err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("Excel 文件为空，缺少表头行")
	}
	if err := validateHeader(rows[0], expected); err != nil {
		return nil, err
	}

	out := make([]ImportRow, 0, len(rows)-1)
	for i := 1; i < len(rows); i++ {
		cells := rows[i]
		if allEmpty(cells) {
			continue // 跳过空行（Excel 末尾常见空白行）
		}
		row := ImportRow{
			Row:      i + 1, // 表头后第一行 = Excel 第 2 行（§5.16.3）
			Category: category,
			Input:    ResourceInput{ResourceCategory: string(category)},
		}
		applyCells(&row, rows[0], cells)
		out = append(out, row)
	}
	return out, nil
}

// validateHeader 校验表头与固定列模板完全一致（§5.16.1 不支持动态列）。
func validateHeader(header, expected []string) error {
	if len(header) == 0 {
		return fmt.Errorf("Excel 缺少表头行")
	}
	for i, want := range expected {
		if i >= len(header) {
			return fmt.Errorf("Excel 列头缺失：第 %d 列应为「%s」（固定列模板，不支持动态列）", i+1, want)
		}
		if got := strings.TrimSpace(header[i]); got != want {
			return fmt.Errorf("Excel 列头与模板不一致：第 %d 列应为「%s」，实际为「%s」（固定列模板，不支持动态列）", i+1, want, got)
		}
	}
	if len(header) > len(expected) {
		return fmt.Errorf("Excel 列头超出模板：第 %d 列「%s」未定义（固定列模板，不支持动态列）", len(expected)+1, strings.TrimSpace(header[len(expected)]))
	}
	return nil
}

// applyCells 按表头把单元格映射到 ImportRow.Input 对应字段。
func applyCells(row *ImportRow, header, cells []string) {
	in := &row.Input
	for idx, col := range header {
		val := ""
		if idx < len(cells) {
			val = strings.TrimSpace(cells[idx])
		}
		switch col {
		case "network_domain":
			in.NetworkDomainID = val
		case "instance_name":
			in.InstanceName = val
		case "hostname":
			in.Hostname = val
		case "instance_ip":
			in.InstanceIP = val
		case "os_type":
			in.OSType = val
		case "biz_code":
			in.BizCode = val
		case "app_name":
			in.AppName = val
		case "env":
			in.Env = val
		case "cluster":
			in.Cluster = val
		case "owner":
			in.Owner = val
		case "status":
			in.Status = val
		case "database_type":
			in.DatabaseType = val
		case "middleware_type":
			in.MiddlewareType = val
		case "port":
			in.Port, row.PortRaw = parsePort(val)
		case "version":
			in.Version = val
		case "service_name":
			in.ServiceName = val
		case "health_check_url":
			in.HealthCheckURL = val
		case "protocol":
			in.Protocol = val
		case "endpoint":
			in.Endpoint = val
		case "target_name":
			in.TargetName = val
		case "metrics_path":
			in.MetricsPath = val
		case "scheme":
			in.Scheme = val
		case "exporter_type":
			in.ExporterType = val
		case "custom_labels":
			row.CustomLabelsRaw = val // 解析与校验在 ValidateImportRow 中完成
		}
	}
}

// parsePort 解析 port 单元格：空 -> (0, "")；合法整数 -> (n, raw)；非数字 ->
// (-1, raw)（-1 哨兵，供校验报错「必须为 1~65535 的整数」）。
func parsePort(raw string) (int, string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, ""
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return -1, raw
	}
	return n, raw
}

// allEmpty 判断一行是否全为空单元格（用于跳过 Excel 末尾空白行）。
func allEmpty(cells []string) bool {
	for _, c := range cells {
		if strings.TrimSpace(c) != "" {
			return false
		}
	}
	return true
}

// ValidateImportRow 对单行执行 §5.16.2 行级校验并就地完善 ImportRow：
//
//   - network_domain 为空自动填 default（§5.16.2）；存在性校验失败给出 §5.16.1
//     引导文案（先去「系统设置 → 网域管理」登记后重新导入）；
//   - status 允许业务语言，经 MapStatus（T07-04）映射为 online/offline/maintenance，
//     映射失败行返回错误（由调用方计入 failed）；
//   - biz_code 必填、编码合法且对应启用字典条目，未登记/停用给出 §5.16.1 引导文案；
//   - generic_target 的 custom_labels 解析为 key=value;key2=value2 格式的 map；
//   - 其余字段校验复用 T07-03 ValidateResourceInput（必填/IP/端口范围/URL/
//     env/protocol/scheme），失败时把错误消息映射回 §5.16.3 的 field/value；
//   - 校验通过后生成 DedupKey（T07-03）到 row.DedupKey 供 upsert 定位。
//
// 失败返回 *ImportRowError（携带完整 row/field/value/reason），成功返回 nil。
func ValidateImportRow(row *ImportRow, bizStore *BusinessDomainStore, networkDomainExists func(string) bool, extraRules []Rule) error {
	if row == nil {
		return &ImportRowError{Detail: models.ImportErrorDetail{Field: "resource", Reason: "导入行为空"}}
	}
	category := row.Category
	in := &row.Input

	// 1. 网域：空自动填 default，再校验存在性（§5.16.2 / §5.16.1 引导闭环）。
	if strings.TrimSpace(in.NetworkDomainID) == "" {
		in.NetworkDomainID = models.DefaultDomainID
	}
	if networkDomainExists != nil && !networkDomainExists(in.NetworkDomainID) {
		return fieldErr(row, "network_domain_id", in.NetworkDomainID,
			fmt.Sprintf("网域 %s 未登记，请先到『系统设置 → 网域管理』登记后重新导入", in.NetworkDomainID))
	}

	// 2. 状态：业务语言经 MapStatus 转枚举（T07-04），转换失败计入 failed。
	mapped, err := MapStatus(in.Status, category, extraRules)
	if err != nil {
		return fieldErr(row, "status", in.Status, fmt.Sprintf("status 状态映射失败：%v", err))
	}
	in.Status = string(mapped)
	row.Status = mapped

	// 3. 业务编码：必填 + 编码规范 + 对应启用条目（§5.16.2 / §3.1）。
	if strings.TrimSpace(in.BizCode) == "" {
		return fieldErr(row, "biz_code", in.BizCode, "biz_code 必填")
	}
	if !models.ValidBizCode.MatchString(in.BizCode) {
		return fieldErr(row, "biz_code", in.BizCode, "biz_code 只能包含小写字母、数字和连字符，长度不超过 64")
	}
	enabled, err := bizStore.GetEnabledMap()
	if err != nil {
		return fieldErr(row, "biz_code", in.BizCode, fmt.Sprintf("业务分组字典加载失败：%v", err))
	}
	if _, ok := enabled[in.BizCode]; !ok {
		return fieldErr(row, "biz_code", in.BizCode,
			fmt.Sprintf("业务 %s 未登记，请到『业务管理』页登记后重新导入", in.BizCode))
	}

	// 4. 非数字 port（ParseExcel 置 -1 哨兵）。
	if in.Port < 0 {
		return fieldErr(row, "port", row.PortRaw, "port 必须为 1~65535 的整数")
	}

	// 5. generic_target 的 custom_labels 格式与解析（§5.16.2）。
	if category == models.ResourceCategoryGenericTarget && strings.TrimSpace(row.CustomLabelsRaw) != "" {
		parsed, perr := parseCustomLabels(row.CustomLabelsRaw)
		if perr != nil {
			return fieldErr(row, "custom_labels", row.CustomLabelsRaw, perr.Error())
		}
		in.CustomLabels = parsed
	}

	// 6. 其余字段校验复用 T07-03（必填/IP/端口范围/URL/env/protocol/scheme）。
	if err := ValidateResourceInput(category, in, bizStore, networkDomainExists); err != nil {
		field := fieldFromResourceInputError(err.Error())
		return fieldErr(row, field, valueFromField(in, field, row.PortRaw), err.Error())
	}

	// 7. 判重键（T07-03）供 upsert 定位。
	row.DedupKey = DedupKey(category, in)
	return nil
}

// fieldErr 构造一个带 §5.16.3 结构信息的行级错误。
func fieldErr(row *ImportRow, field, value, reason string) error {
	return &ImportRowError{Detail: models.ImportErrorDetail{
		Row:              row.Row,
		ResourceCategory: string(row.Category),
		Field:            field,
		Value:            value,
		Reason:           reason,
	}}
}

// parseCustomLabels 解析 custom_labels 单元格（§5.16.1：key1=value1;key2=value2）。
// 空串返回 nil；段内必须含 "=" 且 key/value 均非空。
func parseCustomLabels(raw string) (map[string]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	labels := make(map[string]string)
	for _, seg := range strings.Split(raw, ";") {
		seg = strings.TrimSpace(seg)
		if seg == "" {
			continue // 容忍首尾/连续分号
		}
		kv := strings.SplitN(seg, "=", 2)
		if len(kv) != 2 {
			return nil, fmt.Errorf("custom_labels 格式不正确：应为 key1=value1;key2=value2，当前：%q", raw)
		}
		key := strings.TrimSpace(kv[0])
		value := strings.TrimSpace(kv[1])
		if key == "" || value == "" {
			return nil, fmt.Errorf("custom_labels 格式不正确：key 与 value 均不能为空，应为 key1=value1;key2=value2，当前：%q", raw)
		}
		labels[key] = value
	}
	return labels, nil
}

// resourceInputFieldPrefixes 是 ValidateResourceInput 错误消息中出现的字段名前缀，
// 用于把校验错误映射回 §5.16.3 的 field 字段。
var resourceInputFieldPrefixes = []string{
	"network_domain_id", "biz_code", "env", "status",
	"instance_ip", "instance_name", "hostname", "os_type",
	"database_type", "middleware_type", "port", "version",
	"service_name", "health_check_url", "protocol", "endpoint",
	"target_name", "metrics_path", "scheme", "exporter_type",
	"app_name", "cluster", "resource_category",
}

// fieldFromResourceInputError 从 ValidateResourceInput 的错误消息中提取字段名。
func fieldFromResourceInputError(msg string) string {
	for _, f := range resourceInputFieldPrefixes {
		if strings.HasPrefix(msg, f) {
			return f
		}
	}
	return "resource"
}

// valueFromField 返回 ResourceInput 中指定字段的当前值，用于 §5.16.3 错误的
// value 字段（port 非数字时回退 PortRaw 原文）。
func valueFromField(in *ResourceInput, field, portRaw string) string {
	switch field {
	case "network_domain_id":
		return in.NetworkDomainID
	case "biz_code":
		return in.BizCode
	case "app_name":
		return in.AppName
	case "cluster":
		return in.Cluster
	case "owner":
		return in.Owner
	case "status":
		return in.Status
	case "env":
		return in.Env
	case "instance_name":
		return in.InstanceName
	case "instance_ip":
		return in.InstanceIP
	case "os_type":
		return in.OSType
	case "hostname":
		return in.Hostname
	case "database_type":
		return in.DatabaseType
	case "middleware_type":
		return in.MiddlewareType
	case "port":
		if in.Port < 0 {
			return portRaw
		}
		return strconv.Itoa(in.Port)
	case "version":
		return in.Version
	case "service_name":
		return in.ServiceName
	case "health_check_url":
		return in.HealthCheckURL
	case "protocol":
		return in.Protocol
	case "endpoint":
		return in.Endpoint
	case "target_name":
		return in.TargetName
	case "metrics_path":
		return in.MetricsPath
	case "scheme":
		return in.Scheme
	case "exporter_type":
		return in.ExporterType
	}
	return ""
}

// ValidateRows 逐行执行 ValidateImportRow，返回校验通过的合法行（已含映射后
// Status 与 DedupKey）与失败明细（§5.16.3 结构，row 从 2 起始）。T07-10 导入
// 执行在 ParseExcel 之后调用本函数，作为行级校验与错误行收集的统一入口。
func ValidateRows(rows []ImportRow, bizStore *BusinessDomainStore, networkDomainExists func(string) bool, extraRules []Rule) (valid []ImportRow, errs []models.ImportErrorDetail) {
	for i := range rows {
		if err := ValidateImportRow(&rows[i], bizStore, networkDomainExists, extraRules); err != nil {
			var rerr *ImportRowError
			if errors.As(err, &rerr) {
				errs = append(errs, rerr.Detail)
			} else {
				errs = append(errs, models.ImportErrorDetail{
					Row:              rows[i].Row,
					ResourceCategory: string(rows[i].Category),
					Reason:           err.Error(),
				})
			}
			continue
		}
		valid = append(valid, rows[i])
	}
	return valid, errs
}
