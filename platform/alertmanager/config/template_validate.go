package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/metriccenter/metriccenter/platform/models"
)

// TemplateFuncs 返回通知模板（PL-3 通知渲染桥）在「校验」与「渲染」两处共用的
// Go template 函数集：校验侧用于解析模板（捕捉语法错误），渲染侧用于实际渲染，
// 保证「校验即渲染」口径一致。注册 AM 常用文本函数 + jsonStr（安全 JSON 转义，
// 供模板产出卡片 JSON 时包裹字符串值）。
func TemplateFuncs() template.FuncMap {
	return template.FuncMap{
		"toUpper":   strings.ToUpper,
		"toLower":   strings.ToLower,
		"title":     strings.Title,
		"trimSpace": strings.TrimSpace,
		"join":      strings.Join,
		"contains":  strings.Contains,
		"default":   templateDefault,
		"jsonStr":   templateJSONStr,
	}
}

// templateDefault 返回 default：val 为空（nil / 空字符串）时返回 def，否则返回 val。
func templateDefault(def, val interface{}) interface{} {
	switch t := val.(type) {
	case nil:
		return def
	case string:
		if t == "" {
			return def
		}
	}
	return val
}

// templateJSONStr 将值 JSON 序列化为带引号的字符串字面量（含转义），供模板安全产出 JSON。
func templateJSONStr(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `""`
	}
	return string(b)
}

// ValidateTemplate 校验一段 Alertmanager 标准 Go template 文本（PL-3 通知模板）：
// 复用 alertmanager.yml 的 amtool check-config 等价工序——先用共用 FuncMap 解析模板
// 捕捉 Go 模板语法错误（「含模板解析」），再把模板写入临时文件并生成引用该模板的
// 最小 alertmanager.yml，走同一套 runCheckConfig（复用 lookPathAmtool /
// runAmtoolCheckCmd / devfeedback 注入点与行级错误解析）。校验失败返回 *ErrValidation
// （行级错误，不落库，决策 59/60 纪律）。
func ValidateTemplate(content string) error {
	if strings.TrimSpace(content) == "" {
		return &ErrValidation{
			Items: []models.ValidateErrorItem{{File: "template", Message: "模板内容不能为空"}},
			Note:  validateNote,
		}
	}
	// Go 模板语法解析（amtool 亦会解析模板，此处双保险且不依赖外部工具）。
	if _, err := template.New("notify-template").Funcs(TemplateFuncs()).Parse(content); err != nil {
		return &ErrValidation{
			Items: []models.ValidateErrorItem{{File: "template", Message: "模板解析失败: " + err.Error()}},
			Note:  validateNote,
		}
	}
	// amtool check-config 等价工序：临时模板文件 + 引用 templates 段的最小 alertmanager.yml。
	dir, err := os.MkdirTemp("", "amtpl-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	tplPath := filepath.Join(dir, "notify.tmpl")
	if err := os.WriteFile(tplPath, []byte(content), 0o644); err != nil {
		return err
	}
	items, checkErr := runCheckConfig(buildTemplateCheckConfig(tplPath))
	if checkErr != nil {
		devfeedback(checkErr.Error())
		return &ErrValidation{Items: items, Note: validateNote}
	}
	if len(items) > 0 {
		return &ErrValidation{Items: items, Note: validateNote}
	}
	return nil
}

// buildTemplateCheckConfig 生成用于模板校验的最小可运行 alertmanager.yml：
// 引用平台托管模板文件路径的 templates 段 + 单 receiver，足以让 amtool
// check-config 解析模板并在模板非法时报错。
func buildTemplateCheckConfig(tplPath string) string {
	return "global:\n  resolve_timeout: 5m\ntemplates:\n  - '" + tplPath +
		"'\nroute:\n  receiver: notify-bridge\nreceivers:\n  - name: notify-bridge\n"
}