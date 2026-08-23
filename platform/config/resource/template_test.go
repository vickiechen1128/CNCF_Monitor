package resource

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
)

// fakeDomains 注入的 M06 网域清单（含 default 与一条业务网域），用于「取值说明」sheet 断言。
func fakeDomains() ([]DomainOption, error) {
	return []DomainOption{
		{ID: "default", Name: "默认网域"},
		{ID: "gz-prod-01", Name: "广州生产网域"},
	}, nil
}

// setupTemplateRouter 构造挂载模板下载 handler 的测试路由。
func setupTemplateRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	bizStore := NewBusinessDomainStore(writeDomains(t, sampleYAML))
	r := gin.New()
	r.GET("/api/v2/platform/resources/:type/template", DownloadTemplate(bizStore, fakeDomains))
	return r
}

// allCategories 是五类权威资源类型。
func allCategories() []models.ResourceCategory {
	return models.ValidResourceCategories()
}

// TestTemplateColumnsMatchPRD 断言五类模板列头与 Module_07 §5.16.1 严格一致。
func TestTemplateColumnsMatchPRD(t *testing.T) {
	expected := map[models.ResourceCategory][]string{
		models.ResourceCategoryHost: {
			"network_domain", "instance_name", "hostname", "instance_ip", "os_type",
			"biz_code", "app_name", "env", "cluster", "owner", "status",
		},
		models.ResourceCategoryDatabase: {
			"network_domain", "database_type", "instance_ip", "port", "version",
			"biz_code", "app_name", "env", "cluster", "owner", "status",
		},
		models.ResourceCategoryMiddleware: {
			"network_domain", "middleware_type", "instance_ip", "port", "version",
			"biz_code", "app_name", "env", "cluster", "owner", "status",
		},
		models.ResourceCategoryApplication: {
			"network_domain", "service_name", "biz_code", "health_check_url", "protocol",
			"endpoint", "port", "app_name", "env", "cluster", "owner", "status",
		},
		models.ResourceCategoryGenericTarget: {
			"network_domain", "target_name", "instance_ip", "port", "metrics_path", "scheme",
			"exporter_type", "custom_labels", "biz_code", "app_name", "env", "cluster", "owner", "status",
		},
	}

	require.Len(t, TemplateColumns, len(expected))
	for cat, cols := range expected {
		assert.Equal(t, cols, TemplateColumns[cat], "资源类型 %s 的模板列头必须与 §5.16.1 严格一致", cat)
	}
}

// TestDownloadTemplateHeaders 断言下载响应的 Content-Type 与文件名（{type}_template.xlsx）。
func TestDownloadTemplateHeaders(t *testing.T) {
	for _, cat := range allCategories() {
		t.Run(string(cat), func(t *testing.T) {
			r := setupTemplateRouter(t)
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources/"+string(cat)+"/template", nil)
			r.ServeHTTP(w, req)

			require.Equal(t, http.StatusOK, w.Code)
			assert.Equal(t, xlsxContentType, w.Header().Get("Content-Type"))
			assert.Contains(t, w.Header().Get("Content-Disposition"),
				fmt.Sprintf("%s_template.xlsx", cat), "文件名应为 {type}_template.xlsx")
		})
	}
}

// TestDownloadTemplateSheet1Columns 断言 sheet1 首行列头与模板列定义一致。
func TestDownloadTemplateSheet1Columns(t *testing.T) {
	for _, cat := range allCategories() {
		t.Run(string(cat), func(t *testing.T) {
			r := setupTemplateRouter(t)
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources/"+string(cat)+"/template", nil)
			r.ServeHTTP(w, req)
			require.Equal(t, http.StatusOK, w.Code)

			f, err := excelize.OpenReader(bytes.NewReader(w.Body.Bytes()))
			require.NoError(t, err)
			defer f.Close()

			// sheet1 数据列：默认 sheet 位于 index 0。
			sheet1 := f.GetSheetName(0)
			rows, err := f.GetRows(sheet1)
			require.NoError(t, err)
			require.NotEmpty(t, rows, "sheet1 首行应为列头")
			assert.Equal(t, TemplateColumns[cat], rows[0], "sheet1 首行列头应与模板列定义一致")
		})
	}
}

// TestDownloadTemplateValueSheet 断言「取值说明」sheet 包含网域/业务字典/enum/status/custom_labels 合法值。
func TestDownloadTemplateValueSheet(t *testing.T) {
	r := setupTemplateRouter(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources/host/template", nil)
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	f, err := excelize.OpenReader(bytes.NewReader(w.Body.Bytes()))
	require.NoError(t, err)
	defer f.Close()

	sheetList := f.GetSheetList()
	require.Len(t, sheetList, 2, "模板应包含 sheet1 与「取值说明」两个 sheet")
	assert.Equal(t, "取值说明", sheetList[1])

	rows, err := f.GetRows("取值说明")
	require.NoError(t, err)
	require.NotEmpty(t, rows)
	// 首行为表头
	assert.Equal(t, "取值字段", rows[0][0])

	// 展平全部单元格用于子串断言
	var all strings.Builder
	for _, row := range rows {
		for _, cell := range row {
			all.WriteString(cell)
			all.WriteString("|")
		}
	}
	flat := all.String()

	// network_domain：实时取自 M06 网域清单
	assert.Contains(t, flat, "default", "取值说明应包含 default 网域")
	assert.Contains(t, flat, "gz-prod-01", "取值说明应包含注入的 M06 网域清单")
	// biz_code：业务字典启用项（infra/payment/data-api），停用项 legacy 不出现
	assert.Contains(t, flat, "infra")
	assert.Contains(t, flat, "payment")
	assert.Contains(t, flat, "data-api")
	assert.NotContains(t, flat, "legacy", "停用业务条目不应出现在取值说明")
	// env 枚举
	assert.Contains(t, flat, "dev")
	assert.Contains(t, flat, "staging")
	assert.Contains(t, flat, "prod")
	// status 中文取值（§5.5.1 默认映射）
	assert.Contains(t, flat, "运行中")
	assert.Contains(t, flat, "已停止")
	assert.Contains(t, flat, "维护中")
	// custom_labels 格式说明
	assert.Contains(t, flat, "key1=value1;key2=value2")
}

// TestDownloadTemplateUnknownTypeNotFound 断言未知资源类型返回 not_found。
func TestDownloadTemplateUnknownTypeNotFound(t *testing.T) {
	r := setupTemplateRouter(t)
	for _, typ := range []string{"unknown", "k8s_cluster", "hosts"} {
		t.Run(typ, func(t *testing.T) {
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources/"+typ+"/template", nil)
			r.ServeHTTP(w, req)

			require.Equal(t, http.StatusNotFound, w.Code)
			assert.Contains(t, w.Body.String(), `"errorType":"not_found"`)
			assert.Contains(t, w.Body.String(), "未知资源类型")
		})
	}
}
