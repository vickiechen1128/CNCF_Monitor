package query

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newInspectRouter 以指定上游处理器挂载 InspectRuleLabelsHandler。
func newInspectRouter(t *testing.T, upstream http.Handler) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	srv := httptest.NewServer(upstream)
	t.Cleanup(srv.Close)
	u, err := url.Parse(srv.URL)
	require.NoError(t, err)
	r := gin.New()
	r.POST("/api/v2/platform/monitoring-rule-labels", InspectRuleLabelsHandler(u, http.DefaultClient))
	return r
}

// doInspect 请求探查接口并解码 data.rules。
func doInspect(t *testing.T, r *gin.Engine, ruleContent string) []InspectRuleResult {
	t.Helper()
	body, err := json.Marshal(map[string]string{"rule_content": ruleContent})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/v2/platform/monitoring-rule-labels", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var out struct {
		Status string `json:"status"`
		Data   struct {
			Rules []InspectRuleResult `json:"rules"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Equal(t, "success", out.Status)
	return out.Data.Rules
}

// inspectSeriesFixture 构造中心 Prometheus 瞬时查询响应（拨测序列，标签含 instance/job）。
func inspectSeriesFixture() map[string]interface{} {
	return map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"resultType": "vector",
			"result": []map[string]interface{}{
				{
					"metric": map[string]string{
						"__name__":          "probe_success",
						"instance":          "10.10.1.4",
						"job":               "bx-nginx-02",
						"network_domain_id": "mc-edge-debug",
						"zone_type":         "internet",
					},
					"value": []interface{}{float64(1_700_000_000), "0"},
				},
				{
					"metric": map[string]string{
						"__name__": "probe_success",
						"instance": "172.16.1.2",
						"job":      "bx-nginx-02",
					},
					"value": []interface{}{float64(1_700_000_000), "0"},
				},
			},
		},
	}
}

// TestInspectRuleLabelsForBlackbox 覆盖拨测规则这条真实动线：可用标签清单含 instance，
// 且注解摘要被渲染为真实目标（而不是模板原文）——正是本次缺陷在编辑期的对应面。
func TestInspectRuleLabelsForBlackbox(t *testing.T) {
	r := newInspectRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		body, _ := json.Marshal(inspectSeriesFixture())
		_, _ = w.Write(body)
	}))

	rules := doInspect(t, r, `groups:
  - name: edge_blackbox_alerts
    rules:
      - alert: BlackboxProbeFailed
        expr: probe_success{job="bx-nginx-02"} == 0
        annotations:
          summary: '业务拨测失败：{{ $labels.instance }}'
`)
	require.Len(t, rules, 1)
	row := rules[0]
	assert.Equal(t, "edge_blackbox_alerts", row.Group)
	assert.Equal(t, "BlackboxProbeFailed", row.Rule)
	assert.Equal(t, "alert", row.Kind)
	assert.Empty(t, row.Error)
	assert.Equal(t, 2, row.SeriesCount)

	// __name__ 不是可用标签键，必须被排除。
	keys := make([]string, 0, len(row.Labels))
	for _, l := range row.Labels {
		keys = append(keys, l.Key)
		assert.NotContains(t, l.Values, "")
	}
	assert.Equal(t, []string{"instance", "job", "network_domain_id", "zone_type"}, keys)

	// 注解预览 = 渲染后的值（第一条序列的 instance），绝不是模板原文。
	assert.Equal(t, "业务拨测失败：{{ $labels.instance }}", row.SummaryTemplate)
	assert.Equal(t, "业务拨测失败：10.10.1.4", row.SummaryPreview)
	assert.Empty(t, row.SummaryError)
}

// TestInspectRuleLabelsNoSeries 覆盖「当前无匹配序列」：必须明确告知而不是编造标签清单。
func TestInspectRuleLabelsNoSeries(t *testing.T) {
	r := newInspectRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))

	rules := doInspect(t, r, `groups:
  - name: g
    rules:
      - alert: NoDataYet
        expr: probe_success{job="not-exist"} == 0
        annotations:
          summary: '拨测失败：{{ $labels.instance }}'
`)
	require.Len(t, rules, 1)
	assert.Equal(t, 0, rules[0].SeriesCount)
	assert.Empty(t, rules[0].Labels)
	assert.Contains(t, rules[0].Note, "没有匹配到序列")
	assert.Empty(t, rules[0].SummaryPreview, "无序列时不得给出预览")
}

// TestInspectRuleLabelsInvalidExpr 覆盖 expr 非法：把上游错误原样带回，便于用户定位。
func TestInspectRuleLabelsInvalidExpr(t *testing.T) {
	r := newInspectRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"status":"error","errorType":"bad_data","error":"1:5: parse error: unexpected identifier"}`))
	}))

	rules := doInspect(t, r, `groups:
  - name: g
    rules:
      - alert: BadExpr
        expr: probe_success ===
`)
	require.Len(t, rules, 1)
	assert.Contains(t, rules[0].Error, "parse error")
	assert.Empty(t, rules[0].Labels)
}

// TestInspectRuleLabelsPreviewRenderFailure 覆盖注解模板本身写错：预览为空并给出原因，
// 不把模板原文当作预览展示（否则等于把缺陷搬到编辑期）。
func TestInspectRuleLabelsPreviewRenderFailure(t *testing.T) {
	r := newInspectRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		body, _ := json.Marshal(inspectSeriesFixture())
		_, _ = w.Write(body)
	}))

	rules := doInspect(t, r, `groups:
  - name: g
    rules:
      - alert: BadTemplate
        expr: probe_success == 0
        annotations:
          summary: '坏模板 {{ noSuchFunc "x" }}'
`)
	require.Len(t, rules, 1)
	assert.Empty(t, rules[0].SummaryPreview)
	assert.NotEmpty(t, rules[0].SummaryError)
}

// TestInspectRuleLabelsSkipsNonAlertEntries 覆盖 record 规则与无 expr 条目：给提示、不报错。
func TestInspectRuleLabelsSkipsNonAlertEntries(t *testing.T) {
	r := newInspectRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		body, _ := json.Marshal(inspectSeriesFixture())
		_, _ = w.Write(body)
	}))

	rules := doInspect(t, r, `groups:
  - name: g
    rules:
      - record: job:probe_success:sum
        expr: sum(probe_success)
      - alert: NoExpr
`)
	require.Len(t, rules, 2)
	assert.Equal(t, "record", rules[0].Kind)
	assert.Equal(t, 2, rules[0].SeriesCount, "record 规则同样给出标签清单")
	assert.Equal(t, "alert", rules[1].Kind)
	assert.Contains(t, rules[1].Note, "没有 expr")
}

// TestInspectRuleLabelsInvalidYAML YAML 非法时返回说明而非报错（「检查」才是语法门禁）。
func TestInspectRuleLabelsInvalidYAML(t *testing.T) {
	r := newInspectRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("YAML 非法时不应访问上游 Prometheus")
	}))
	rules := doInspect(t, r, "groups: [ 坏 yaml")
	require.Len(t, rules, 1)
	assert.Contains(t, rules[0].Error, "不是合法 YAML")
}
