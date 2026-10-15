package resource

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// fakeDomains 注入的 M06 网域清单（含 default 与一条业务网域），用于「取值说明」sheet 断言。
func fakeDomains() ([]DomainOption, error) {
	return []DomainOption{
		{ID: "default", Name: "默认网域"},
		{ID: "gz-prod-01", Name: "广州生产网域"},
	}, nil
}

// setupTemplateRouter 构造挂载模板下载 handler 的测试路由（biz/app 字典均注入实时 store）。
func setupTemplateRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	bizStore := newBizStore(t)
	r := gin.New()
	r.GET("/api/v2/platform/resources/:type/template", DownloadTemplate(bizStore, newAppStore(t), newPlatformStore(t), fakeDomains))
	return r
}

// openEmptyAppDictDB 打开不落任何应用条目的内存 DB（F-7 ① 空应用字典占位断言）。
func openEmptyAppDictDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:resource_app_template_empty?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.ApplicationDict{}))
	return db
}

// emptyDictTemplateDBCounter 为「全空字典」测试生成唯一内存 DB 名。
var emptyDictTemplateDBCounter int64

// openEmptyDictDB 打开三张字典表全空的内存 DB（业务/应用/平台），用于模板取值
// 说明在无任何字典数据时的降级断言。
func openEmptyDictDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&emptyDictTemplateDBCounter, 1)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:resource_template_empty_dict_%d?mode=memory&cache=shared", n)), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.BusinessDomain{}, &models.ApplicationDict{}, &models.PlatformDict{}))
	return db
}

// allCategories 是五类权威资源类型。
func allCategories() []models.ResourceCategory {
	return models.ValidResourceCategories()
}

// containsColumn 报告 cols 是否含 want 列（用于按类别条件化断言）。
func containsColumn(cols []string, want string) bool {
	for _, c := range cols {
		if c == want {
			return true
		}
	}
	return false
}

// flattenRows 把「取值说明」二维单元格展平为 `cell|cell|...`，便于子串断言。
func flattenRows(rows [][]string) string {
	var b strings.Builder
	for _, row := range rows {
		for _, cell := range row {
			b.WriteString(cell)
			b.WriteString("|")
		}
	}
	return b.String()
}

// downloadTemplate 通过真实 handler 下载某类别模板并返回两个 sheet 的行数据。
func downloadTemplate(t *testing.T, category models.ResourceCategory) (sheet1, valueSheet [][]string) {
	t.Helper()
	r := setupTemplateRouter(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources/"+string(category)+"/template", nil)
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	f, err := excelize.OpenReader(bytes.NewReader(w.Body.Bytes()))
	require.NoError(t, err)
	defer f.Close()

	sheet1, err = f.GetRows(f.GetSheetName(0))
	require.NoError(t, err)
	valueSheet, err = f.GetRows("取值说明")
	require.NoError(t, err)
	return sheet1, valueSheet
}

// valueSheetColumnRows 提取「取值说明」中第 3 行起的列说明行（跳过表头与示例行提示）。
func valueSheetColumnRows(valueSheet [][]string) [][]string {
	if len(valueSheet) <= 2 {
		return nil
	}
	return valueSheet[2:]
}

// TestTemplateColumnsMatchPRD 断言五类模板列头与 Module_07 §5.16.1 严格一致
// （决策 D-7 P1：五类末尾统一追加可选 scrape_port 列，一律末尾追加不插中间；
// PRD §5.16.1 回填归设计侧，开发不改 PRD）。
func TestTemplateColumnsMatchPRD(t *testing.T) {
	expected := map[models.ResourceCategory][]string{
		// 决策 101 后续：zone_env 已废弃，host 模板不再输出该列（原特征：列头含
		// zone_env，位于 cluster 与 owner 之间，共 14 列）。
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
		// 决策 110：五类模板均在 app_code 之后新增可空 platform_code 列。
		models.ResourceCategoryApplication: {
			"network_domain", "service_name", "biz_code", "health_check_url", "protocol",
			"endpoint", "port", "app_code", "platform_code", "env", "cluster", "owner", "status",
			"scrape_port",
		},
		models.ResourceCategoryGenericTarget: {
			"network_domain", "target_name", "instance_ip", "port", "metrics_path", "scheme",
			"exporter_type", "custom_labels", "biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status",
			"scrape_port",
		},
		// 接口服务用平台自带的 blackbox_exporter 探活（目标即完整 URL），无采集端口
		// 语义，是全类别里唯一**不追加** scrape_port 尾列的。
		models.ResourceCategoryInterfaceService: {
			"network_domain", "api_name", "api_url", "biz_code", "app_code", "env", "status",
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
	// zone_env：已废弃（决策 101 后续），取值说明不再出现该列的任何释义
	//（原特征：断言包含「INT（互联网区 internet）/ GOV（政务外网区 extranet）」
	// 与「不进标签、不作分区权威」两条兼容列提示）。
	assert.NotContains(t, flat, "zone_env", "已废弃列不应出现在取值说明")
	assert.NotContains(t, flat, "INT（互联网区 internet）/ GOV（政务外网区 extranet）")
	assert.NotContains(t, flat, "不进标签、不作分区权威")
	// biz_code：业务字典启用项（infra/payment/data-api），停用项 legacy 不出现
	assert.Contains(t, flat, "infra")
	assert.Contains(t, flat, "payment")
	assert.Contains(t, flat, "data-api")
	assert.NotContains(t, flat, "legacy", "停用业务条目不应出现在取值说明")
	// app_code：应用字典启用项（决策 92/96，F-7 ① 实时注入），停用项 legacy-app 不出现
	assert.Contains(t, flat, "pay-db（支付库）", "取值说明应含应用字典启用条目 code（名称）")
	assert.Contains(t, flat, "pay-service（支付服务）")
	assert.NotContains(t, flat, "legacy-app", "停用应用条目不应出现在取值说明")
	// env 枚举
	assert.Contains(t, flat, "dev")
	assert.Contains(t, flat, "staging")
	assert.Contains(t, flat, "prod")
	// status 中文取值（§5.5.1 默认映射）
	assert.Contains(t, flat, "运行中")
	assert.Contains(t, flat, "已停止")
	assert.Contains(t, flat, "维护中")
}

// TestDownloadTemplateValueSheet_CustomLabelsOnlyForGenericTarget 断言 custom_labels
// 格式说明只出现在 generic_target 的取值说明中（F-24：sheet2 按类别过滤，
// host 不再出现其他类别独有列的说明）。
func TestDownloadTemplateValueSheet_CustomLabelsOnlyForGenericTarget(t *testing.T) {
	for _, cat := range []models.ResourceCategory{models.ResourceCategoryHost, models.ResourceCategoryGenericTarget} {
		t.Run(string(cat), func(t *testing.T) {
			r := setupTemplateRouter(t)
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources/"+string(cat)+"/template", nil)
			r.ServeHTTP(w, req)
			require.Equal(t, http.StatusOK, w.Code)

			f, err := excelize.OpenReader(bytes.NewReader(w.Body.Bytes()))
			require.NoError(t, err)
			defer f.Close()
			rows, err := f.GetRows("取值说明")
			require.NoError(t, err)
			flat := flattenRows(rows)
			if cat == models.ResourceCategoryGenericTarget {
				assert.Contains(t, flat, "key1=value1;key2=value2", "generic_target 应含 custom_labels 格式说明")
			} else {
				assert.NotContains(t, flat, "key1=value1", "host 取值说明不应出现 generic_target 独有列 custom_labels")
				assert.NotContains(t, flat, "custom_labels")
			}
		})
	}
}

// TestDownloadTemplateValueSheet_EmptyAppDict 断言应用字典为空时 app_code 行给出占位
// 引导（F-7 ①：空字典不输出空串，提示「暂无已登记应用」）。
func TestDownloadTemplateValueSheet_EmptyAppDict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v2/platform/resources/:type/template",
		DownloadTemplate(newBizStore(t), NewApplicationDictStore(openEmptyAppDictDB(t)), newPlatformStore(t), fakeDomains))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources/host/template", nil)
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	f, err := excelize.OpenReader(bytes.NewReader(w.Body.Bytes()))
	require.NoError(t, err)
	defer f.Close()

	rows, err := f.GetRows("取值说明")
	require.NoError(t, err)
	var all strings.Builder
	for _, row := range rows {
		for _, cell := range row {
			all.WriteString(cell)
			all.WriteString("|")
		}
	}
	flat := all.String()
	assert.Contains(t, flat, "暂无已登记应用", "空应用字典应输出占位引导，而非空串")
	assert.Contains(t, flat, "infra", "空应用字典不影响 biz_code 行")
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

// TestTemplateColumnDocsCoverAllColumns 断言静态说明表覆盖 TemplateColumns 全部取值，
// 且中文含义非空（F-23-②：新增列若漏登记中文含义会被此测试拦下）。
func TestTemplateColumnDocsCoverAllColumns(t *testing.T) {
	for cat, cols := range TemplateColumns {
		for _, col := range cols {
			doc, ok := templateColumnDocs[col]
			assert.True(t, ok, "列 %s（%s）缺少 templateColumnDocs 登记", col, cat)
			assert.NotEmpty(t, doc.Label, "列 %s 缺少中文含义", col)
		}
	}
	for col := range templateColumnDocs {
		used := false
		for _, cols := range TemplateColumns {
			for _, c := range cols {
				if c == col {
					used = true
				}
			}
		}
		assert.True(t, used, "templateColumnDocs 中的 %s 不在任何类别模板列中，应删除", col)
	}
}

// TestDownloadTemplateValueSheetColumnsPerCategory 断言五类「取值说明」只输出该类别
// sheet1 实际拥有的列，且行序与 sheet1 列序完全一致（F-24：以 TemplateColumns 为
// 唯一权威来源，不另立类别→列映射）。
func TestDownloadTemplateValueSheetColumnsPerCategory(t *testing.T) {
	for _, cat := range allCategories() {
		t.Run(string(cat), func(t *testing.T) {
			sheet1, valueSheet := downloadTemplate(t, cat)
			require.NotEmpty(t, sheet1)
			require.NotEmpty(t, valueSheet)

			// 表头 4 列：取值字段 / 中文含义 / 必填口径 / 合法值 / 格式说明
			assert.Equal(t, []string{"取值字段", "中文含义", "必填口径", "合法值 / 格式说明"}, valueSheetHeaderRow)
			assert.Equal(t, valueSheetHeaderRow, valueSheet[0], "取值说明首行为表头")

			rows := valueSheetColumnRows(valueSheet)
			require.Len(t, rows, len(TemplateColumns[cat]),
				"取值说明行数应等于该类别 sheet1 列数（不允许混入其他类别的列）")
			for i, col := range TemplateColumns[cat] {
				assert.Equal(t, col, rows[i][0], "第 %d 行取值字段应为 %s（行序必须与 sheet1 列序一致）", i+2, col)
				assert.NotEmpty(t, rows[i][3], "列 %s 应给出合法值 / 格式说明", col)
			}
		})
	}
}

// TestDownloadTemplateValueSheetHasChineseLabel 断言取值说明每行都给出中文含义，
// 且中文含义与页面列名对齐（对齐 resourceColumnPrefs / ResourceFormDrawer 的 label）。
func TestDownloadTemplateValueSheetHasChineseLabel(t *testing.T) {
	for _, cat := range allCategories() {
		t.Run(string(cat), func(t *testing.T) {
			_, valueSheet := downloadTemplate(t, cat)
			for i, row := range valueSheetColumnRows(valueSheet) {
				require.GreaterOrEqual(t, len(row), 2, "第 %d 行缺少中文含义列", i+3)
				assert.Equal(t, templateColumnDocs[row[0]].Label, row[1],
					"列 %s 的中文含义应与静态说明表一致", row[0])
				assert.NotEmpty(t, row[1], "列 %s 的中文含义不应为空", row[0])
			}
			// 抽样对齐页面实际展示名（对齐 ui-custom/web 列元数据 label，只读参考）
			_, host := downloadTemplate(t, models.ResourceCategoryHost)
			assert.Contains(t, flattenRows(host), "instance_ip|IP 地址|")
			assert.Contains(t, flattenRows(host), "biz_code|业务名称|")
			assert.Contains(t, flattenRows(host), "os_type|操作系统|")
			assert.Contains(t, flattenRows(host), "network_domain|网域|")
		})
	}
}

// TestDownloadTemplateValueSheetRequiredLabel 断言取值说明逐列标注必填口径，
// 并如实反映导入侧后端口径（含 generic_target 二选一）。
func TestDownloadTemplateValueSheetRequiredLabel(t *testing.T) {
	requiredCases := map[models.ResourceCategory]map[string]string{
		models.ResourceCategoryHost: {
			"instance_ip": "必填", "os_type": "必填", "env": "必填",
			"biz_code": "可留空", "app_code": "可留空", "cluster": "可留空",
			"network_domain": "可留空", "status": "可留空",
		},
		models.ResourceCategoryDatabase: {
			"app_code": "必填", "cluster": "必填", "database_type": "必填",
			"port": "必填", "env": "必填", "biz_code": "可留空",
		},
		models.ResourceCategoryMiddleware: {
			"app_code": "必填", "cluster": "必填", "middleware_type": "必填",
			"port": "必填", "env": "必填", "biz_code": "可留空",
		},
		models.ResourceCategoryApplication: {
			"biz_code": "必填", "app_code": "必填", "cluster": "必填",
			"service_name": "必填", "endpoint": "必填", "port": "必填", "env": "必填",
		},
		models.ResourceCategoryGenericTarget: {
			"biz_code": "二选一", "app_code": "二选一",
			"target_name": "必填", "instance_ip": "必填", "env": "必填",
			"port": "可留空", "cluster": "可留空",
		},
	}
	for _, cat := range allCategories() {
		t.Run(string(cat), func(t *testing.T) {
			_, valueSheet := downloadTemplate(t, cat)
			got := map[string]string{}
			for _, row := range valueSheetColumnRows(valueSheet) {
				got[row[0]] = row[2]
			}
			for col, want := range requiredCases[cat] {
				label, ok := got[col]
				require.True(t, ok, "取值说明缺少列 %s 的必填口径", col)
				assert.True(t, strings.HasPrefix(label, want),
					"列 %s 必填口径应以「%s」开头，实际为 %q", col, want, label)
			}
		})
	}
}

// TestDownloadTemplateValueSheetNoteRow 断言取值说明顶部提示行说明示例行需删除。
func TestDownloadTemplateValueSheetNoteRow(t *testing.T) {
	for _, cat := range allCategories() {
		t.Run(string(cat), func(t *testing.T) {
			_, valueSheet := downloadTemplate(t, cat)
			require.GreaterOrEqual(t, len(valueSheet), 2)
			assert.Equal(t, "（填写说明）", valueSheet[1][0])
			assert.Equal(t, "sheet1 第 2 行为示例行，导入前请删除", valueSheet[1][1])
		})
	}
}

// TestDownloadTemplateExampleRow 断言 sheet1 第 2 行为示例数据行：必填列有值、
// 选填列留空（F-23-①）。
func TestDownloadTemplateExampleRow(t *testing.T) {
	for _, cat := range allCategories() {
		t.Run(string(cat), func(t *testing.T) {
			sheet1, _ := downloadTemplate(t, cat)
			require.GreaterOrEqual(t, len(sheet1), 2, "sheet1 应含表头 + 示例行")

			// GetRows 会裁掉行尾空单元格，按列头补齐后再逐列判定。
			example := sheet1[1]
			require.LessOrEqual(t, len(example), len(TemplateColumns[cat]))
			for i, col := range TemplateColumns[cat] {
				val := ""
				if i < len(example) {
					val = strings.TrimSpace(example[i])
				}
				label := templateColumnRequiredLabel(cat, col)
				if strings.HasPrefix(label, "可留空") || strings.HasPrefix(label, "二选一") {
					if col == "biz_code" && cat == models.ResourceCategoryGenericTarget {
						assert.NotEmpty(t, val, "generic_target 示例行应演示二选一的 biz_code 一侧")
						continue
					}
					if col == "app_code" && cat == models.ResourceCategoryGenericTarget {
						assert.Empty(t, val, "generic_target 示例行只演示二选一的一侧，app_code 应留空")
						continue
					}
					assert.Empty(t, val, "选填列 %s 的示例值应留空（口径：%s）", col, label)
					continue
				}
				assert.NotEmpty(t, val, "必填列 %s 的示例值不应为空（口径：%s）", col, label)
			}
		})
	}
}

// TestDownloadTemplateExampleRowStyle 断言示例行带浅色底纹（与普通数据行可区分）。
func TestDownloadTemplateExampleRowStyle(t *testing.T) {
	r := setupTemplateRouter(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources/host/template", nil)
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	f, err := excelize.OpenReader(bytes.NewReader(w.Body.Bytes()))
	require.NoError(t, err)
	defer f.Close()
	sheet := f.GetSheetName(0)

	styleID, err := f.GetCellStyle(sheet, "A2")
	require.NoError(t, err)
	require.NotZero(t, styleID, "示例行 A2 应带专用样式（底纹标注为示例）")

	style, err := f.GetStyle(styleID)
	require.NoError(t, err)
	require.NotNil(t, style.Fill)
	assert.Equal(t, "pattern", style.Fill.Type)
	assert.Equal(t, []string{"F2F2F2"}, style.Fill.Color)
	require.NotNil(t, style.Font)
	assert.True(t, style.Font.Italic, "示例行应用斜体标注")
}

// TestParseExcelSkipsTemplateExampleRow 断言「下载模板未删示例行直接上传」时，
// 示例行不会被解析为用户数据行（F-23-① 防误导入关键策略）。
func TestParseExcelSkipsTemplateExampleRow(t *testing.T) {
	for _, cat := range allCategories() {
		t.Run(string(cat), func(t *testing.T) {
			// 1) 仅示例行：解析结果为空，不产生任何待导入数据行。
			rows, err := ParseExcel(buildXLSX(t, cat, [][]string{templateExampleRow(cat)}), cat)
			require.NoError(t, err)
			assert.Empty(t, rows, "示例行不得被解析为待导入数据行")

			// 2) 示例行 + 真实数据行：只保留真实行，且行号仍为 Excel 原始行号。
			real := makeRow(cat, baseValues(cat))
			rows, err = ParseExcel(buildXLSX(t, cat, [][]string{templateExampleRow(cat), real}), cat)
			require.NoError(t, err)
			require.Len(t, rows, 1, "仅真实数据行应被保留")
			assert.Equal(t, 3, rows[0].Row, "行号应保持 Excel 原始行号（示例行占第 2 行）")

			// 3) 用户在示例行基础上改了任一格：该行按普通数据行走原有流程。
			edited := makeRow(cat, baseValues(cat))
			rows, err = ParseExcel(buildXLSX(t, cat, [][]string{edited}), cat)
			require.NoError(t, err)
			require.Len(t, rows, 1, "用户填写的行不应被当作示例行跳过")
			assert.Equal(t, 2, rows[0].Row)
		})
	}
}

// TestDownloadedTemplateParsesToZeroRows 端到端断言：真实下载的模板原样上传时，
// 解析结果为空（示例行不会污染导入），确保模板提示文案与实现一致。
func TestDownloadedTemplateParsesToZeroRows(t *testing.T) {
	for _, cat := range allCategories() {
		t.Run(string(cat), func(t *testing.T) {
			r := setupTemplateRouter(t)
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources/"+string(cat)+"/template", nil)
			r.ServeHTTP(w, req)
			require.Equal(t, http.StatusOK, w.Code)

			rows, err := ParseExcel(w.Body.Bytes(), cat)
			require.NoError(t, err)
			assert.Empty(t, rows, "未填写数据的模板应解析出 0 行（示例行被跳过）")
		})
	}
}

// TestBuildValueSheetEmptyDictsNoPanic 断言字典与网域清单全空（含 nil 平台 store）时，
// 取值说明仍能生成且不 panic（降级行为）。
func TestBuildValueSheetEmptyDictsNoPanic(t *testing.T) {
	gin.SetMode(gin.TestMode)
	emptyDB := openEmptyDictDB(t)
	bizStore := NewBusinessDomainStore(emptyDB)
	appStore := NewApplicationDictStore(emptyDB)
	platformStore := NewPlatformDictStore(emptyDB)

	t.Run("全部字典与网域清单为空", func(t *testing.T) {
		for _, cat := range allCategories() {
			rows, err := buildValueSheet(cat, bizStore, appStore, platformStore,
				func() ([]DomainOption, error) { return nil, nil })
			require.NoError(t, err)
			require.Len(t, rows, len(TemplateColumns[cat])+2)
			flat := flattenRows(rows)
			assert.Contains(t, flat, "暂无已登记应用", "空应用字典应输出占位引导，而非空串")
			// interface_service 模板刻意不含 platform_code 列，故仅在含该列的类别上断言
			// 平台兜底说明。
			if containsColumn(TemplateColumns[cat], "platform_code") {
				assert.Contains(t, flat, "可空列，留空按所属应用主平台兜底", "平台字典为空时保留兜底说明")
			}
		}
	})

	t.Run("平台字典 store 为 nil", func(t *testing.T) {
		require.NotPanics(t, func() {
			rows, err := buildValueSheet(models.ResourceCategoryApplication, bizStore, appStore, nil, fakeDomains)
			require.NoError(t, err)
			assert.Len(t, rows, len(TemplateColumns[models.ResourceCategoryApplication])+2)
		})
	})

	t.Run("listDomains 为 nil", func(t *testing.T) {
		require.NotPanics(t, func() {
			rows, err := buildValueSheet(models.ResourceCategoryHost, bizStore, appStore, platformStore, nil)
			require.NoError(t, err)
			assert.Len(t, rows, len(TemplateColumns[models.ResourceCategoryHost])+2)
		})
	})
}
