package domain

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var memDBCounter int64

// openTestDB opens a per-test in-memory SQLite DB with the tables the domain package touches.
func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:dom_onboard_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Tenant{},
		&models.NetworkDomain{},
	))
	return db
}

// seedDomain inserts a network domain fixture with the given id and is_monitored state.
func seedDomain(t *testing.T, db *gorm.DB, id string, domainType models.DomainType, monitored bool) *models.NetworkDomain {
	t.Helper()
	d := &models.NetworkDomain{
		ID:          id,
		Name:        "域-" + id,
		DomainType:  domainType,
		TenantID:    models.PlatformAdminTenantID,
		Status:      models.DomainStatusEnabled,
		Channel:     models.ChannelTypeLocal,
		IsMonitored: monitored,
	}
	require.NoError(t, db.Create(d).Error)
	return d
}

func newGin() *gin.Engine {
	gin.SetMode(gin.TestMode)
	return gin.New()
}

// perform executes a request against the engine and returns the recorder.
func perform(t *testing.T, r *gin.Engine, method, path string, body string) *httptest.ResponseRecorder {
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

// ==================== Service layer ====================

func TestMonitorDomainDefaultForcesLocal(t *testing.T) {
	db := openTestDB(t)
	seedDomain(t, db, models.DefaultDomainID, models.DomainTypeManagement, false)

	out, err := MonitorDomain(db, models.DefaultDomainID, MonitorParams{})
	require.NoError(t, err)
	assert.Equal(t, models.ChannelTypeLocal, out.Domain.Channel, "default 域强制 local")
	assert.Equal(t, models.AgentType(""), out.Domain.AgentType, "local 无 agent")
	assert.True(t, out.Domain.IsMonitored)
	assert.Empty(t, out.Token, "local 不签发 token")
	assert.Empty(t, out.Domain.RemoteWriteURL)
	assert.Equal(t, "", out.Domain.TokenMaskedView)
}

func TestMonitorDomainEdgeAgentPullSignsToken(t *testing.T) {
	db := openTestDB(t)
	seedDomain(t, db, "edge-e1", models.DomainTypeEdge, false)

	out, err := MonitorDomain(db, "edge-e1", MonitorParams{AgentType: string(models.AgentTypeVMAgent), RemoteWriteURL: "http://10.0.0.1:8428"})
	require.NoError(t, err)
	assert.Equal(t, models.ChannelTypeAgentPull, out.Domain.Channel, "非 default 记为 agent_pull")
	assert.Equal(t, models.AgentTypeVMAgent, out.Domain.AgentType, "MVP 固定 vmagent")
	assert.Equal(t, "http://10.0.0.1:8428", out.Domain.RemoteWriteURL)
	assert.True(t, out.Domain.IsMonitored)
	assert.NotEmpty(t, out.Token, "agent_pull 签发一次性 token")
	assert.Equal(t, models.TokenMasked(out.Token), out.Domain.TokenMaskedView)
	// 明文 token 落库，脱敏视图与明文对应。
	var stored models.NetworkDomain
	require.NoError(t, db.Where("id = ?", "edge-e1").First(&stored).Error)
	assert.Equal(t, out.Token, stored.Token, "明文仅服务端存储")
	assert.Equal(t, models.TokenMasked(out.Token), stored.TokenMaskedView, "AfterFind 派生脱敏视图（gorm:\"-\"，不落库）")
}

func TestMonitorDomainRejectsAlreadyMonitored(t *testing.T) {
	db := openTestDB(t)
	seedDomain(t, db, "edge-e2", models.DomainTypeEdge, true)
	_, err := MonitorDomain(db, "edge-e2", MonitorParams{})
	assert.ErrorIs(t, err, ErrAlreadyMonitored)
}

func TestMonitorDomainRejectsInvalidAgentType(t *testing.T) {
	db := openTestDB(t)
	seedDomain(t, db, "edge-e3", models.DomainTypeEdge, false)
	_, err := MonitorDomain(db, "edge-e3", MonitorParams{AgentType: "prometheus_old"})
	assert.ErrorIs(t, err, ErrInvalidAgentType)
}

func TestMonitorDomainNotFound(t *testing.T) {
	db := openTestDB(t)
	_, err := MonitorDomain(db, "missing", MonitorParams{})
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestResetDomainTokenEdgePush(t *testing.T) {
	db := openTestDB(t)
	dom := seedDomain(t, db, "edge-r1", models.DomainTypeEdge, false)
	// 直接置为 agent_pull 已纳管。
	dom.Channel = models.ChannelTypeAgentPull
	dom.Token = "old-token"
	dom.IsMonitored = true
	require.NoError(t, db.Model(dom).Updates(map[string]interface{}{"channel": "agent_pull", "token": "old-token", "is_monitored": true}).Error)

	res, err := ResetDomainToken(db, "edge-r1")
	require.NoError(t, err)
	assert.NotEmpty(t, res.Token)
	assert.Equal(t, models.TokenMasked(res.Token), res.TokenMasked)
	assert.NotEqual(t, "old-token", res.Token, "token 已重置")
	var stored models.NetworkDomain
	require.NoError(t, db.Where("id = ?", "edge-r1").First(&stored).Error)
	assert.Equal(t, res.Token, stored.Token)
}

func TestResetDomainTokenRejectsLocal(t *testing.T) {
	db := openTestDB(t)
	seedDomain(t, db, models.DefaultDomainID, models.DomainTypeManagement, true)
	_, err := ResetDomainToken(db, models.DefaultDomainID)
	assert.ErrorIs(t, err, ErrResetNotAgentPull, "local 网域不可重置 token")
}

func TestResetDomainTokenRejectsNotMonitored(t *testing.T) {
	db := openTestDB(t)
	dom := seedDomain(t, db, "edge-r2", models.DomainTypeEdge, false)
	dom.Channel = models.ChannelTypeAgentPull
	require.NoError(t, db.Model(dom).Update("channel", "agent_pull").Error)
	_, err := ResetDomainToken(db, "edge-r2")
	assert.ErrorIs(t, err, ErrResetRequiresMonitored)
}

func TestUpdateDomainMonitoring(t *testing.T) {
	db := openTestDB(t)
	dom := seedDomain(t, db, "edge-u1", models.DomainTypeEdge, false)
	dom.Channel = models.ChannelTypeAgentPull
	require.NoError(t, db.Model(dom).Update("channel", "agent_pull").Error)
	// 标记为已纳管以便更新。
	require.NoError(t, db.Model(dom).Update("is_monitored", true).Error)

	on := true
	updated, err := UpdateDomainMonitoring(db, "edge-u1", UpdateParams{
		AgentType:      string(models.AgentTypeVMAgent),
		RemoteWriteURL: "http://new:8428",
		Description:    "更新说明",
		IsMonitored:    &on,
	})
	require.NoError(t, err)
	assert.Equal(t, models.AgentTypeVMAgent, updated.AgentType)
	assert.Equal(t, "http://new:8428", updated.RemoteWriteURL)
	assert.Equal(t, "更新说明", updated.Description)
	assert.True(t, updated.IsMonitored)
}

func TestUpdateDomainMonitoringUnmonitor(t *testing.T) {
	db := openTestDB(t)
	dom := seedDomain(t, db, "edge-u2", models.DomainTypeEdge, false)
	dom.Channel = models.ChannelTypeAgentPull
	require.NoError(t, db.Model(dom).Updates(map[string]interface{}{"channel": "agent_pull", "is_monitored": true}).Error)

	off := false
	updated, err := UpdateDomainMonitoring(db, "edge-u2", UpdateParams{IsMonitored: &off})
	require.NoError(t, err)
	assert.False(t, updated.IsMonitored)
}

func TestUpdateDomainMonitoringRequiresMonitored(t *testing.T) {
	db := openTestDB(t)
	seedDomain(t, db, "edge-u3", models.DomainTypeEdge, false)
	_, err := UpdateDomainMonitoring(db, "edge-u3", UpdateParams{Description: "x"})
	assert.ErrorIs(t, err, ErrNotMonitored)
}

// ==================== HTTP layer ====================

func TestMonitorHandlerRoutes(t *testing.T) {
	db := openTestDB(t)
	seedDomain(t, db, models.DefaultDomainID, models.DomainTypeManagement, false)
	seedDomain(t, db, "edge-h1", models.DomainTypeEdge, false)

	r := newGin()
	g := r.Group("/api/v2/platform")
	RegisterRoutes(g, db)

	// default 域 local 纳管。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/network-domains/default/monitor", `{"agent_type":"vmagent"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var defResp struct {
		Data struct {
			Domain models.NetworkDomain `json:"domain"`
			Token  string               `json:"token"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &defResp))
	assert.Equal(t, models.ChannelTypeLocal, defResp.Data.Domain.Channel)
	assert.Empty(t, defResp.Data.Token, "local 纳管返回空 token")

	// 边缘域 agent_pull 签发 token。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/network-domains/edge-h1/monitor", `{"agent_type":"vmagent","remote_write_url":"http://a:8428"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var edgeResp struct {
		Data struct {
			Domain models.NetworkDomain `json:"domain"`
			Token  string               `json:"token"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &edgeResp))
	assert.Equal(t, models.ChannelTypeAgentPull, edgeResp.Data.Domain.Channel)
	assert.NotEmpty(t, edgeResp.Data.Token, "边缘生成一次性 token，明文仅纳管成功单次返回")
	// 响应中的脱敏字段必须与明文 token 完全脱敏一致（不显明文片段）。
	assert.Equal(t, models.TokenMasked(edgeResp.Data.Token), edgeResp.Data.Domain.TokenMaskedView)

	// 重复纳管返回 bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/network-domains/edge-h1/monitor", `{}`)
	assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())

	// 未找到返回 not_found。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/network-domains/nope/monitor", `{}`)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestResetTokenHandler(t *testing.T) {
	db := openTestDB(t)
	dom := seedDomain(t, db, "edge-h2", models.DomainTypeEdge, false)
	dom.Channel = models.ChannelTypeAgentPull
	dom.IsMonitored = true
	require.NoError(t, db.Model(dom).Updates(map[string]interface{}{"channel": "agent_pull", "is_monitored": true}).Error)

	r := newGin()
	g := r.Group("/api/v2/platform")
	RegisterRoutes(g, db)

	w := perform(t, r, http.MethodPost, "/api/v2/platform/network-domains/edge-h2/reset-token", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp struct {
		Data struct {
			Token       string `json:"token"`
			TokenMasked string `json:"token_masked"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.NotEmpty(t, resp.Data.Token)
	assert.Equal(t, models.TokenMasked(resp.Data.Token), resp.Data.TokenMasked)

	// local 默认域重置被拒绝（bad_request）。
	seedDomain(t, db, models.DefaultDomainID, models.DomainTypeManagement, true)
	w = perform(t, r, http.MethodPost, "/api/v2/platform/network-domains/default/reset-token", "")
	assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
}