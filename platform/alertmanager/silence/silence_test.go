package silence

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newFakeAM 启动一个 scriptable Alertmanager 桩服务，返回 (server, client 工厂)。
// 通过 fakeAM.silences 控制列表、fakeAM.createHook 记录创建体、fakeAM.notFoundSet
// 控制「不存在」的静默 ID（DELETE/GET 返回 404）。
type fakeAM struct {
	mu           sync.Mutex
	silences     []amSilence
	created      []amCreateSilenceRequest
	notFoundAIDs []string
}

func (f *fakeAM) setList(s []amSilence) { f.mu.Lock(); defer f.mu.Unlock(); f.silences = s }
func (f *fakeAM) createdBodies() []amCreateSilenceRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]amCreateSilenceRequest(nil), f.created...)
}
func (f *fakeAM) markNotFound(ids ...string) { f.mu.Lock(); defer f.mu.Unlock(); f.notFoundAIDs = append(f.notFoundAIDs, ids...) }

func (f *fakeAM) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/silences":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "data": f.silences})
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/v1/silence/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/v1/silence/")
			for _, nf := range f.notFoundAIDs {
				if nf == id {
					w.WriteHeader(http.StatusNotFound)
					return
				}
			}
			for _, s := range f.silences {
				if s.ID == id {
					_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "data": s})
					return
				}
			}
			w.WriteHeader(http.StatusNotFound)
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/silences":
			var body amCreateSilenceRequest
			_ = json.NewDecoder(r.Body).Decode(&body)
			f.created = append(f.created, body)
			id := "am-" + time.Now().Format("150405.000000000")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "success",
				"data":   map[string]string{"silenceID": id},
			})
		case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/api/v1/silence/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/v1/silence/")
			for _, nf := range f.notFoundAIDs {
				if nf == id {
					w.WriteHeader(http.StatusNotFound)
					return
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "success"})
		default:
			http.NotFound(w, r)
		}
	})
}

func startFakeAM(t *testing.T, f *fakeAM) string {
	t.Helper()
	srv := httptest.NewServer(f.handler())
	t.Cleanup(srv.Close)
	return srv.URL
}

func boolp(b bool) *bool { return &b }

func newTestService(t *testing.T) (*Service, *fakeAM) {
	t.Helper()
	f := &fakeAM{}
	proxy, err := NewProxy(startFakeAM(t, f))
	require.NoError(t, err)
	return NewService(proxy), f
}

var (
	tNow     = time.Now()
	tStart   = tNow.Add(-1 * time.Hour)
	tEnd     = tNow.Add(1 * time.Hour)
	matchers = []models.SilenceMatcher{
		{Name: "network_domain", Value: "finance", IsEqual: true, IsRegex: false},
	}
)

// --- Service 列表映射 ---

func TestServiceListMapsActiveSilences(t *testing.T) {
	svc, f := newTestService(t)
	var s1, s2 amSilence
	s1 = amSilence{ID: "s1", Matchers: []amMatcher{{Name: "network_domain", Value: "finance", IsEqual: boolp(true), IsRegex: boolp(false)}}, StartsAt: tStart, EndsAt: tEnd, CreatedBy: "u1", Comment: "维护窗口"}
	s1.Status.State = "active"
	s2 = amSilence{ID: "s2", Matchers: nil, StartsAt: tStart, EndsAt: tEnd, CreatedBy: "u2", Comment: "x"}
	s2.Status.State = "active"
	f.setList([]amSilence{s1, s2})
	out, err := svc.List(context.Background(), true)
	require.NoError(t, err)
	require.Len(t, out, 2)
	assert.Equal(t, "s1", out[0].ID)
	require.Len(t, out[0].Matchers, 1)
	assert.Equal(t, models.SilenceMatcher{Name: "network_domain", Value: "finance", IsEqual: true, IsRegex: false}, out[0].Matchers[0])
	assert.Equal(t, "维护窗口", out[0].Comment)
}

func TestServiceListEmpty(t *testing.T) {
	svc, f := newTestService(t)
	f.setList(nil)
	out, err := svc.List(context.Background(), true)
	require.NoError(t, err)
	assert.Empty(t, out)
}

// --- Service 创建（含授权校验） ---

func TestServiceCreateValid(t *testing.T) {
	svc, f := newTestService(t)
	created, err := svc.Create(context.Background(), &models.AuthorizedMatcherScope{AllDomains: true}, CreateInput{
		Matchers: matchers, StartsAt: tStart, EndsAt: tEnd, Comment: "窗口", CreatedBy: "u1",
	})
	require.NoError(t, err)
	assert.NotEmpty(t, created.ID)
	require.Len(t, f.createdBodies(), 1)
	req := f.createdBodies()[0]
	require.NotNil(t, req.CreatedBy)
	assert.Equal(t, "u1", req.CreatedBy)
}

func TestServiceCreateValidatesMissingFields(t *testing.T) {
	svc, _ := newTestService(t)
	_, err := svc.Create(context.Background(), &models.AuthorizedMatcherScope{AllDomains: true}, CreateInput{})
	require.Error(t, err)
}

func TestServiceCreateRejectsOutOfScopeMatcher(t *testing.T) {
	svc, f := newTestService(t)
	scope := &models.AuthorizedMatcherScope{AllDomains: false, Domains: []string{"finance"}}
	_, err := svc.Create(context.Background(), scope, CreateInput{
		Matchers: []models.SilenceMatcher{{Name: "network_domain", Value: "hr", IsEqual: true}},
		StartsAt: tStart, EndsAt: tEnd, Comment: "c",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "outside authorized scope")
	assert.Empty(t, f.createdBodies(), "越权 matcher 不应真正调用 AM 创建")
}

// --- Service 删除 ---

func TestServiceDeleteOK(t *testing.T) {
	svc, f := newTestService(t)
	f.setList([]amSilence{{ID: "s1", StartsAt: tStart, EndsAt: tEnd, Comment: "c"}})
	got, err := svc.Delete(context.Background(), "s1")
	require.NoError(t, err)
	assert.Equal(t, "s1", got)
}

func TestServiceDeleteNotFound(t *testing.T) {
	svc, f := newTestService(t)
	f.markNotFound("nope")
	_, err := svc.Delete(context.Background(), "nope")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrSilenceNotFound)
}

// --- Proxy 基础 ---

func TestNewProxyRejectsBadScheme(t *testing.T) {
	_, err := NewProxy("ftp://host")
	require.Error(t, err)
	_, err = NewProxy("http://")
	require.Error(t, err)
	_, err = NewProxy("http://localhost:9093")
	require.NoError(t, err)
}

// --- paginate ---

func TestPaginate(t *testing.T) {
	list := make([]Silence, 5)
	total, page := paginate(list, 1, 2)
	assert.Equal(t, 5, total)
	assert.Len(t, page, 2)
	total, page = paginate(list, 3, 2)
	assert.Equal(t, 5, total)
	assert.Len(t, page, 1)
	total, page = paginate(list, 99, 2)
	assert.Equal(t, 5, total)
	assert.Empty(t, page)
}

// --- Handler 层 ---

func newSilenceRouter(svc *Service) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v2/platform/alertmanager/silences")
	g.GET("", ListHandler(svc))
	g.POST("", CreateHandler(svc))
	g.DELETE("/:silence_id", DeleteHandler(svc))
	return r
}

func silenceRequest(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rd)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestListEndpoint(t *testing.T) {
	svc, f := newTestService(t)
	var s9 amSilence
	s9 = amSilence{ID: "s9", StartsAt: tStart, EndsAt: tEnd, Comment: "c"}
	s9.Status.State = "active"
	f.setList([]amSilence{s9})
	r := newSilenceRouter(svc)
	w := silenceRequest(t, r, http.MethodGet, "/api/v2/platform/alertmanager/silences", "")
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "c", decodeAt(w, []string{"data", "items", "0", "comment"}), w.Body.String())
}

func TestCreateEndpointInvalidBody(t *testing.T) {
	svc, _ := newTestService(t)
	r := newSilenceRouter(svc)
	w := silenceRequest(t, r, http.MethodPost, "/api/v2/platform/alertmanager/silences", `{}`)
	assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
}

func TestDeleteEndpointNotFound(t *testing.T) {
	svc, f := newTestService(t)
	f.markNotFound("ghost")
	r := newSilenceRouter(svc)
	w := silenceRequest(t, r, http.MethodDelete, "/api/v2/platform/alertmanager/silences/ghost", "")
	assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
}

// decodeAt 从 JSON 响应按点分路径取值（用于断言嵌套字段），支持 map 与数组索引。
func decodeAt(w *httptest.ResponseRecorder, path []string) string {
	var m map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		return ""
	}
	var cur interface{} = m
	for _, key := range path {
		switch t := cur.(type) {
		case map[string]interface{}:
			cur = t[key]
		case []interface{}:
			var idx int
			if _, err := fmt.Sscanf(key, "%d", &idx); err != nil || idx < 0 || idx >= len(t) {
				return ""
			}
			cur = t[idx]
		default:
			return ""
		}
	}
	if s, ok := cur.(string); ok {
		return s
	}
	return ""
}