package notify

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"text/template"

	"github.com/metriccenter/metriccenter/platform/models"
)

// This file inlines the few template-validation helpers previously borrowed
// from platform/alertmanager/config. Keeping them inside notify prevents the
// v3 binary from linking the legacy config package (which in turn pulls in
// configcenter/*, strategy/* and deployment code that must stay out of v3).

// ErrValidation is the line-level validation error returned by the template
// service. It is intentionally structurally identical to config.ErrValidation
// so the unchanged tests (which inject that type) and the HTTP error mapper
// (which reads fields structurally, see validationErrorFields) interoperate.
type ErrValidation struct {
	Items []models.ValidateErrorItem
	Note  string
	Cause models.ValidationCause
}

func (e *ErrValidation) Error() string {
	if len(e.Items) == 0 {
		return "alertmanager config validation failed"
	}
	return e.Items[0].Message
}

const (
	validationNote       = "校验失败未保存、未生效；修改后请重新挂载"
	amtoolUnavailableMsg = "amtool check-config 不可调用，无法完成校验；请确保部署环境已提供 Alertmanager CLI（amtool）"
)

// templateFuncs mirrors config.TemplateFuncs(): the same FuncMap is used for
// parse-time validation and render-time execution ("校验即渲染").
func templateFuncs() template.FuncMap {
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

func templateJSONStr(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `""`
	}
	return string(b)
}

// validateTemplate is the notify-owned default for validateTemplateFn: parse
// the Go template (catching syntax errors without any external tool) and then
// ask amtool check-config to validate the minimal alertmanager.yml that uses
// the template. amtool unavailability is reported as a validation failure.
func validateTemplate(content string) error {
	if strings.TrimSpace(content) == "" {
		return &ErrValidation{
			Items: []models.ValidateErrorItem{{File: "template", Message: "模板内容不能为空"}},
			Note:  validationNote,
		}
	}
	if _, err := template.New("notify-template").Funcs(templateFuncs()).Parse(content); err != nil {
		return &ErrValidation{
			Items: []models.ValidateErrorItem{{File: "template", Message: "模板解析失败: " + err.Error()}},
			Note:  validationNote,
		}
	}
	dir, err := os.MkdirTemp("", "amtpl-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	tplPath := filepath.Join(dir, "notify.tmpl")
	if err := os.WriteFile(tplPath, []byte(content), 0o644); err != nil {
		return err
	}
	cfg := "global:\n  resolve_timeout: 5m\ntemplates:\n  - '" + tplPath +
		"'\nroute:\n  receiver: notify-bridge\nreceivers:\n  - name: notify-bridge\n"
	items, checkErr := checkTemplateConfig(cfg)
	if checkErr != nil {
		log.Printf("[notify] dev-feedback: %s", checkErr.Error())
		return &ErrValidation{Items: items, Note: validationNote, Cause: models.ValidationCausePlatformFault}
	}
	if len(items) > 0 {
		return &ErrValidation{Items: items, Note: validationNote, Cause: models.ValidationCauseUserConfig}
	}
	return nil
}

func checkTemplateConfig(content string) ([]models.ValidateErrorItem, error) {
	amtool, err := exec.LookPath("amtool")
	if err != nil {
		return []models.ValidateErrorItem{{File: "alertmanager.yml", Message: amtoolUnavailableMsg}},
			errors.New(amtoolUnavailableMsg)
	}
	dir, err := os.MkdirTemp("", "amcheck-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	cfgPath := filepath.Join(dir, "alertmanager.yml")
	if err := os.WriteFile(cfgPath, []byte(content), 0o644); err != nil {
		return nil, err
	}
	out, cmdErr := exec.Command(amtool, "check-config", cfgPath).CombinedOutput()
	text := string(out)
	if strings.Contains(text, "SUCCESS") {
		return nil, nil
	}
	if cmdErr != nil && !strings.Contains(text, "FAILED") {
		msg := amtoolUnavailableMsg + "：" + cmdErr.Error()
		return []models.ValidateErrorItem{{File: "alertmanager.yml", Message: msg}}, errors.New(msg)
	}
	return parseValidationErrors(text), nil
}

var validationLinePattern = regexp.MustCompile(`:\s*(\d+)\s*:|\bline\s+(\d+)\b|\((\d+)\)`)

func parseValidationErrors(output string) []models.ValidateErrorItem {
	items := make([]models.ValidateErrorItem, 0)
	for _, raw := range strings.Split(strings.TrimSpace(output), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.Contains(line, "Checking '") {
			continue
		}
		items = append(items, models.ValidateErrorItem{
			File:    "alertmanager.yml",
			Line:    validationLine(line),
			Message: strings.TrimRight(strings.TrimLeft(line, ": "), " :"),
		})
	}
	if len(items) == 0 {
		items = append(items, models.ValidateErrorItem{File: "alertmanager.yml", Message: "amtool check-config 校验失败"})
	}
	return items
}

func validationLine(line string) int {
	m := validationLinePattern.FindStringSubmatch(line)
	if m == nil {
		return 0
	}
	for _, group := range m[1:] {
		if group != "" {
			var n int
			if _, err := fmt.Sscanf(group, "%d", &n); err == nil {
				return n
			}
		}
	}
	return 0
}

// validationErrorFields extracts {items, note, cause} from any error whose
// underlying value is a struct with those fields. This lets the HTTP mapper
// recognise both notify.ErrValidation and config.ErrValidation (injected by
// the unchanged tests) without importing the legacy config package.
func validationErrorFields(err error) ([]models.ValidateErrorItem, string, models.ValidationCause, bool) {
	for err != nil {
		v := reflect.ValueOf(err)
		for v.IsValid() && v.Kind() == reflect.Ptr {
			if v.IsNil() {
				return nil, "", "", false
			}
			v = v.Elem()
		}
		if v.IsValid() && v.Kind() == reflect.Struct {
			itemsVal := v.FieldByName("Items")
			noteVal := v.FieldByName("Note")
			if itemsVal.IsValid() && itemsVal.CanInterface() && noteVal.IsValid() && noteVal.CanInterface() {
				items, ok := itemsVal.Interface().([]models.ValidateErrorItem)
				if ok {
					note, _ := noteVal.Interface().(string)
					var cause models.ValidationCause
					if cv := v.FieldByName("Cause"); cv.IsValid() && cv.CanInterface() {
						cause, _ = cv.Interface().(models.ValidationCause)
					}
					return items, note, cause, true
				}
			}
		}
		err = errors.Unwrap(err)
	}
	return nil, "", "", false
}
