package edge

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/models"
)

// ---- 测试辅助 ----

// seedMonitoredEdgeDomain 建一个已纳管（is_monitored=true）的 agent_pull 网域。
func seedMonitoredEdgeDomain(t *testing.T, db *gorm.DB, id, token, agentType, endpoint string) *models.NetworkDomain {
	t.Helper()
	dom := seedEdgeDomain(db, id, "agent_pull", token, agentType, endpoint)
	dom.IsMonitored = true
	require.NoError(t, db.Model(dom).Update("is_monitored", true).Error)
	return dom
}

func tPtr(t time.Time) *time.Time { return &t }

func seedAgent(t *testing.T, db *gorm.DB, domainID, status string, lastHB *time.Time, comps []models.EdgeComponent) *models.EdgeAgent {
	t.Helper()
	a := &models.EdgeAgent{
		NetworkDomainID: domainID,
		AgentType:       models.AgentTypeVMAgent,
		Hostname:        "host-" + domainID,
		Status:          status,
		LastHeartbeat:   lastHB,
		Components:      comps,
	}
	require.NoError(t, db.Create(a).Error)
	return a
}

// newManagementRouter 仅挂管理面路由（不带全局用户 auth，单测直接验证 handler 语义）。
func newManagementRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterManagementRoutes(r.Group("/api/v2/platform"), db)
	return r
}

// ---- T11-06 退纳管级联清退（决策 D3） ----

func TestRetireDomainCascadeClearsTokenAndRetiresAgents(t *testing.T) {
	db := newEdgeTestDB(t)
	_ = seedMonitoredEdgeDomain(t, db, "edge-retire", "secret-token", "vmagent", "http://c:8080")
	seedAgent(t, db, "edge-retire", "online", tPtr(time.Now()), nil)

	out, err := RetireDomain(db, "edge-retire")
	require.NoError(t, err)
	assert.Equal(t, models.RegistrationStatusRetired, out.RegistrationStatus)
	assert.False(t, out.IsMonitored)
	assert.Empty(t, out.Token, "退纳管废止 token")
	assert.Empty(t, out.MonitoredStatus, "运行态清空")

	// 节点置 retired 终态。
	var agents []models.EdgeAgent
	require.NoError(t, db.Where("network_domain_id = ?", "edge-retire").Find(&agents).Error)
	require.Len(t, agents, 1)
	assert.Equal(t, AgentStatusRetired, agents[0].Status, "节点级联置 retired 终态")
}

func TestRetireDomainRejectsManagementAndRetiredAndNotMonitoredAndMissing(t *testing.T) {
	db := newEdgeTestDB(t)
	// 管理域不可退纳管。
	mgmt := &models.NetworkDomain{
		ID: models.DefaultDomainID, Name: "default",
		DomainType:         models.DomainTypeManagement,
		Channel:            models.ChannelTypeLocal,
		TenantID:           "tenant-1",
		Status:             models.DomainStatusEnabled,
		RegistrationStatus: models.RegistrationStatusMonitored,
		IsMonitored:        true,
	}
	require.NoError(t, db.Create(mgmt).Error)
	_, err := RetireDomain(db, models.DefaultDomainID)
	assert.ErrorIs(t, err, ErrRetireManagementDomain)

	// 未纳管不可退纳管。
	seedEdgeDomain(db, "edge-nm", "agent_pull", "tk", "vmagent", "")
	_, err = RetireDomain(db, "edge-nm")
	assert.ErrorIs(t, err, ErrRetireNotMonitored)

	// 已处 retired 终态幂等拒绝。
	_ = seedMonitoredEdgeDomain(t, db, "edge-ar", "tk", "vmagent", "")
	_, err = RetireDomain(db, "edge-ar")
	require.NoError(t, err)
	_, err = RetireDomain(db, "edge-ar")
	assert.ErrorIs(t, err, ErrRetireAlreadyRetired)

	// 不存在 → not found。
	_, err = RetireDomain(db, "missing")
	assert.ErrorIs(t, err, ErrRetireNotFound)
}

func TestRetireDomainHandlerHTTP(t *testing.T) {
	db := newEdgeTestDB(t)
	seedMonitoredEdgeDomain(t, db, "edge-h", "tk-h", "vmagent", "")
	r := newManagementRouter(db)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodDelete,
		"/api/v2/platform/network-domains/edge-h/monitor", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var resp struct {
		Data struct {
			RegistrationStatus models.RegistrationStatus `json:"registration_status"`
			IsMonitored        bool                       `json:"is_monitored"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, models.RegistrationStatusRetired, resp.Data.RegistrationStatus)
	assert.False(t, resp.Data.IsMonitored)

	// 重复退纳管 → 409。
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, httptest.NewRequest(http.MethodDelete,
		"/api/v2/platform/network-domains/edge-h/monitor", nil))
	assert.Equal(t, http.StatusConflict, w2.Code)

	// 不存在 → 404。
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, httptest.NewRequest(http.MethodDelete,
		"/api/v2/platform/network-domains/nope/monitor", nil))
	assert.Equal(t, http.StatusNotFound, w3.Code)
}

// ---- T11-07 离线探测器（阈值 90s）+ 网域聚合 + 事件钩子 ----

var detectNow = time.Date(2026, 9, 18, 10, 0, 0, 0, time.UTC)

func TestDetectOfflineFlagsOldHeartbeatAndTriggersOfflineHook(t *testing.T) {
	db := newEdgeTestDB(t)
	_ = seedMonitoredEdgeDomain(t, db, "edge-o1", "tk", "vmagent", "")
	// 两个节点心跳均超 90s。
	seedAgent(t, db, "edge-o1", "online", tPtr(detectNow.Add(-100*time.Second)), nil)
	seedAgent(t, db, "edge-o1", "online", tPtr(detectNow.Add(-200*time.Second)), nil)

	var fired []string
	offline, err := DetectOffline(db, DefaultOfflineThreshold, detectNow,
		func(domainID string) error { fired = append(fired, domainID); return nil })
	require.NoError(t, err)
	assert.Equal(t, []string{"edge-o1"}, offline, "网域整体离线触发 hook")
	assert.Equal(t, []string{"edge-o1"}, fired)

	// 节点状态全部落库为 offline。
	var agents []models.EdgeAgent
	require.NoError(t, db.Where("network_domain_id = ?", "edge-o1").Find(&agents).Error)
	for _, a := range agents {
		assert.Equal(t, AgentStatusOffline, a.Status)
	}

	// 网域运行态聚合为 offline。
	var dom2 models.NetworkDomain
	require.NoError(t, db.First(&dom2, "id = ?", "edge-o1").Error)
	assert.Equal(t, DomainRuntimeOffline, dom2.MonitoredStatus)
}

func TestDetectOfflineHookFiresOnlyOnTransition(t *testing.T) {
	db := newEdgeTestDB(t)
	seedMonitoredEdgeDomain(t, db, "edge-tr", "tk", "vmagent", "")
	seedAgent(t, db, "edge-tr", "online", tPtr(detectNow.Add(-100*time.Second)), nil)

	var fired []string
	// 第一次：online→offline 迁移，触发 hook。
	offline, err := DetectOffline(db, DefaultOfflineThreshold, detectNow,
		func(d string) error { fired = append(fired, d); return nil })
	require.NoError(t, err)
	assert.Equal(t, []string{"edge-tr"}, offline)
	assert.Len(t, fired, 1)

	// 第二次（相同 now）：已 offline，不重复触发。
	offline2, err := DetectOffline(db, DefaultOfflineThreshold, detectNow,
		func(d string) error { fired = append(fired, d); return nil })
	require.NoError(t, err)
	assert.Empty(t, offline2, "非 offline→offline 转换不触发")
	assert.Len(t, fired, 1, "hook 仅迁移时触发一次")
}

func TestDetectOfflineMixedAgentsYieldsPartialAndNoHook(t *testing.T) {
	db := newEdgeTestDB(t)
	seedMonitoredEdgeDomain(t, db, "edge-mx", "tk", "vmagent", "")
	seedAgent(t, db, "edge-mx", "online", tPtr(detectNow.Add(-100*time.Second)), nil) // 离线
	seedAgent(t, db, "edge-mx", "online", tPtr(detectNow.Add(-10*time.Second)), nil)  // 在线

	var fired []string
	_, err := DetectOffline(db, DefaultOfflineThreshold, detectNow,
		func(d string) error { fired = append(fired, d); return nil })
	require.NoError(t, err)
	assert.Empty(t, fired, "部分异常不触发离线 hook")

	var dom models.NetworkDomain
	require.NoError(t, db.First(&dom, "id = ?", "edge-mx").Error)
	assert.Equal(t, DomainRuntimePartial, dom.MonitoredStatus, "在/离混合 → partial")
}

func TestDetectOfflineRecoversWhenHeartbeatResumes(t *testing.T) {
	db := newEdgeTestDB(t)
	seedMonitoredEdgeDomain(t, db, "edge-rc", "tk", "vmagent", "")
	seedAgent(t, db, "edge-rc", "online", tPtr(detectNow.Add(-100*time.Second)), nil)

	_, err := DetectOffline(db, DefaultOfflineThreshold, detectNow, nil)
	require.NoError(t, err)

	// 心跳恢复：更新到 10s 内，再探测 → online，网域 normal。
	require.NoError(t, db.Model(&models.EdgeAgent{}).Where("network_domain_id=?", "edge-rc").
		Update("last_heartbeat", detectNow.Add(-10*time.Second)).Error)
	// 现状态已是 offline，liveStatus 依据 heartbeat 恢复为 online。
	_, err = DetectOffline(db, DefaultOfflineThreshold, detectNow, nil)
	require.NoError(t, err)

	var agents []models.EdgeAgent
	require.NoError(t, db.Where("network_domain_id = ?", "edge-rc").Find(&agents).Error)
	assert.Equal(t, AgentStatusOnline, agents[0].Status, "心跳恢复回 online")
	var dom models.NetworkDomain
	require.NoError(t, db.First(&dom, "id = ?", "edge-rc").Error)
	assert.Equal(t, DomainRuntimeNormal, dom.MonitoredStatus)
}

// ---- T11-07 edge-agents 列表 / 详情（三档聚合 + 组件诊断） ----

func TestListAgentsThreeTierAggregation(t *testing.T) {
	db := newEdgeTestDB(t)
	seedMonitoredEdgeDomain(t, db, "edge-list", "tk", "vmagent", "")
	// 在线且健康 → online
	seedAgent(t, db, "edge-list", "online", tPtr(detectNow.Add(-10*time.Second)), []models.EdgeComponent{
		{Type: models.ComponentTypeCollector, Name: "vmagent", Status: models.ComponentStatusRunning},
	})
	// 在线但采集器 crash_loop → partial（必装组件异常，§3.2）
	seedAgent(t, db, "edge-list", "online", tPtr(detectNow.Add(-20*time.Second)), []models.EdgeComponent{
		{Type: models.ComponentTypeCollector, Name: "vmagent", Status: models.ComponentStatusCrashLoop},
	})
	// 离线 → offline
	seedAgent(t, db, "edge-list", "online", tPtr(detectNow.Add(-200*time.Second)), nil)
	// retired 不计入聚合
	seedAgent(t, db, "edge-list", "retired", tPtr(detectNow), nil)

	resp, err := ListAgents(db, detectNow, DefaultOfflineThreshold)
	require.NoError(t, err)
	assert.Equal(t, DomainRuntimePartial, resp.Overall)
	assert.Equal(t, 3, resp.Summary.Total, "retired 不计入")
	assert.Equal(t, 1, resp.Summary.Online)
	assert.Equal(t, 1, resp.Summary.Partial)
	assert.Equal(t, 1, resp.Summary.Offline)
	assert.Len(t, resp.Agents, 4, "retired 仍出现在列表（终态展示）")
}

func TestListAgentsAllOnlineIsNormal(t *testing.T) {
	db := newEdgeTestDB(t)
	seedMonitoredEdgeDomain(t, db, "edge-all", "tk", "vmagent", "")
	seedAgent(t, db, "edge-all", "online", tPtr(detectNow.Add(-5*time.Second)), nil)
	seedAgent(t, db, "edge-all", "online", tPtr(detectNow.Add(-8*time.Second)), nil)

	resp, err := ListAgents(db, detectNow, DefaultOfflineThreshold)
	require.NoError(t, err)
	assert.Equal(t, DomainRuntimeNormal, resp.Overall)
	assert.Equal(t, 2, resp.Summary.Total)
	assert.Equal(t, 2, resp.Summary.Online)
	assert.Zero(t, resp.Summary.Partial)
	assert.Zero(t, resp.Summary.Offline)
}

func TestGetAgentDetailIncludesComponents(t *testing.T) {
	db := newEdgeTestDB(t)
	seedMonitoredEdgeDomain(t, db, "edge-det", "tk", "vmagent", "")
	a := seedAgent(t, db, "edge-det", "online", tPtr(detectNow.Add(-10*time.Second)), []models.EdgeComponent{
		{Type: models.ComponentTypeCollector, Name: "vmagent", Status: models.ComponentStatusRunning},
	})

	v, err := GetAgent(db, a.ID, detectNow, DefaultOfflineThreshold)
	require.NoError(t, err)
	assert.Equal(t, AgentStatusOnline, v.Status)
	require.Len(t, v.Components, 1)
	assert.Equal(t, models.ComponentTypeCollector, v.Components[0].Type)
	assert.NotNil(t, v.LastHeartbeat, "心跳时间已格式化")
}

func TestGetAgentNotFound(t *testing.T) {
	db := newEdgeTestDB(t)
	_, err := GetAgent(db, 99999, detectNow, DefaultOfflineThreshold)
	assert.ErrorIs(t, err, ErrRetireNotFound)
}

// TestAgentViewDegradesComponentsWhenHeartbeatExpired 覆盖 F-15 症状层：agent 心跳
// 超时（离线）时，展示用的组件状态（CollectorStatus / Components[].status）必须覆写为
// unknown，消除「节点离线却采集器/拨测器仍显示运行中」的认知冲突（历史心跳快照过期）。
// 同时断言 DB 原始上报值未被改动——仅展示层降级，agent 恢复心跳后自然回真实值。
func TestAgentViewDegradesComponentsWhenHeartbeatExpired(t *testing.T) {
	db := newEdgeTestDB(t)
	seedMonitoredEdgeDomain(t, db, "edge-stale", "tk", "vmagent", "")
	a := seedAgent(t, db, "edge-stale", "online", tPtr(detectNow.Add(-200*time.Second)), []models.EdgeComponent{
		{Type: models.ComponentTypeCollector, Name: "vmagent", Status: models.ComponentStatusRunning},
		{Type: models.ComponentTypeBlackbox, Name: "blackbox_exporter", Status: models.ComponentStatusRunning},
	})
	require.NoError(t, db.Model(a).Update("collector_status", string(models.ComponentStatusRunning)).Error)

	v, err := GetAgent(db, a.ID, detectNow, DefaultOfflineThreshold)
	require.NoError(t, err)
	assert.Equal(t, AgentStatusOffline, v.Status, "心跳过期 → 节点离线")
	assert.Equal(t, AgentStatusUnknown, v.CollectorStatus, "心跳过期 → 采集器状态降级 unknown")
	require.Len(t, v.Components, 2)
	for _, c := range v.Components {
		assert.Equal(t, models.ComponentStatus("unknown"), c.Status, "心跳过期 → 组件状态降级 unknown: %s", c.Type)
	}

	// 展示层降级不改 DB 原始上报值。
	var raw models.EdgeAgent
	require.NoError(t, db.First(&raw, a.ID).Error)
	assert.Equal(t, string(models.ComponentStatusRunning), raw.CollectorStatus, "DB 原始值不变")
	require.Len(t, raw.Components, 2)
	assert.Equal(t, models.ComponentStatusRunning, raw.Components[0].Status, "DB 组件状态不变")
}

// TestAgentViewKeepsComponentStatusWhenHeartbeatFresh 心跳未过期时不降级（回归保护：
// 避免降级逻辑误伤在线节点）。
func TestAgentViewKeepsComponentStatusWhenHeartbeatFresh(t *testing.T) {
	db := newEdgeTestDB(t)
	seedMonitoredEdgeDomain(t, db, "edge-fresh", "tk", "vmagent", "")
	a := seedAgent(t, db, "edge-fresh", "online", tPtr(detectNow.Add(-10*time.Second)), []models.EdgeComponent{
		{Type: models.ComponentTypeCollector, Name: "vmagent", Status: models.ComponentStatusRunning},
	})
	require.NoError(t, db.Model(a).Update("collector_status", string(models.ComponentStatusRunning)).Error)

	v, err := GetAgent(db, a.ID, detectNow, DefaultOfflineThreshold)
	require.NoError(t, err)
	assert.Equal(t, AgentStatusOnline, v.Status)
	assert.Equal(t, string(models.ComponentStatusRunning), v.CollectorStatus, "在线不降级")
	require.Len(t, v.Components, 1)
	assert.Equal(t, models.ComponentStatusRunning, v.Components[0].Status, "在线组件状态不降级")
}

func TestListAgentsAndGetAgentHandlers(t *testing.T) {
	db := newEdgeTestDB(t)
	seedMonitoredEdgeDomain(t, db, "edge-hl", "tk", "vmagent", "")
	a := seedAgent(t, db, "edge-hl", "online", tPtr(detectNow.Add(-10*time.Second)), nil)
	r := newManagementRouter(db)

	// 列表。
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v2/platform/edge-agents", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	// 详情。
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v2/platform/edge-agents/%d", a.ID), nil))
	require.Equal(t, http.StatusOK, w2.Code, w2.Body.String())

	// 非法 id → 400。
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, httptest.NewRequest(http.MethodGet, "/api/v2/platform/edge-agents/not-a-number", nil))
	assert.Equal(t, http.StatusBadRequest, w3.Code)

	// 不存在 → 404。
	w4 := httptest.NewRecorder()
	r.ServeHTTP(w4, httptest.NewRequest(http.MethodGet, "/api/v2/platform/edge-agents/99999", nil))
	assert.Equal(t, http.StatusNotFound, w4.Code)
}

// ---- T11-08 edge-packages 清单 + 下载 ----

func TestListPackagesFields(t *testing.T) {
	pkgs, err := ListPackages()
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(pkgs), 2, "应有可读的版本集")

	latest := pkgs[0]
	for _, p := range pkgs {
		assert.NotEmpty(t, p.ID)
		assert.NotEmpty(t, p.Version)
		assert.Equal(t, offlinePackageDownloadPathFor(p.Version), p.DownloadURL, "各包 download_url 指向自身版本")
		assert.Equal(t, 64, len(p.Sha256), "sha256 应为 64 位十六进制")
		assert.Greater(t, p.SizeBytes, int64(0))
		// 包清单三组件。
		names := map[string]bool{}
		for _, c := range p.Components {
			names[c.Name] = true
			assert.NotEmpty(t, c.Version)
			assert.Equal(t, 64, len(c.Sha256))
			assert.Greater(t, c.SizeBytes, int64(0))
		}
		assert.True(t, names[EdgeSyncAgentComponent], "含 edge-sync-agent")
		assert.True(t, names[VMAgentComponent], "含 vmagent")
		assert.True(t, names[BlackboxComponent], "含 blackbox_exporter")
	}

	// 列表按版本降序（首个为最新）。
	require.Equal(t, "v0.2.0", latest.Version, "最新包版本")
}

func TestLatestPackageIsMaxVersion(t *testing.T) {
	latest, err := LatestPackage()
	require.NoError(t, err)
	assert.Equal(t, "v0.2.0", latest.Version)
	assert.NotEmpty(t, latest.Sha256)
	assert.Equal(t, offlinePackageDownloadPathFor("v0.2.0"), latest.DownloadURL, "最新包 download_url 指向自身版本")
}

func TestDownloadLatestPackageHandlerServesZip(t *testing.T) {
	r := newManagementRouter(newEdgeTestDB(t))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge-packages/latest/download", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "application/zip", w.Header().Get("Content-Type"))
	assert.Equal(t, `attachment; filename="edge-agent-offline-v0.2.0.zip"`, w.Header().Get("Content-Disposition"))

	sha := w.Header().Get("X-Checksum-Sha256")
	assert.Equal(t, sha, trimETag(w.Header().Get("ETag")), "ETag 携带整包 sha256")

	// zip 可读且含 metadata.json（版本为最新）。
	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	require.NoError(t, err)
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	assert.True(t, names["metadata.json"])
	assert.True(t, names[EdgeSyncAgentComponent])
	assert.True(t, names[VMAgentComponent])
	assert.True(t, names[BlackboxComponent])

	// 整包 sha256 与重建一致（可复算）。
	_, recomputed, err := buildOfflinePackageZip(mustLatestArtifact(t))
	require.NoError(t, err)
	assert.Equal(t, recomputed, sha)
}

// mustLatestArtifact 返回最新包 artifact（供可复算比对）。
func mustLatestArtifact(t *testing.T) PackageArtifact {
	t.Helper()
	a, err := LatestPackage()
	require.NoError(t, err)
	return a
}

// ---- T11-20 指定版本离线包下载 ----

func TestFindPackageByVersion(t *testing.T) {
	// 命中。
	art, err := FindPackage("v0.1.0")
	require.NoError(t, err)
	assert.Equal(t, "v0.1.0", art.Version)
	assert.Equal(t, offlinePackageDownloadPathFor("v0.1.0"), art.DownloadURL)
	assert.NotEmpty(t, art.Sha256)
	assert.Greater(t, art.SizeBytes, int64(0))

	// 未命中 → ErrPackageNotFound。
	_, err = FindPackage("v9.9.9")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrPackageNotFound)
}

func TestDownloadPackageHandlerServesZipForVersion(t *testing.T) {
	r := newManagementRouter(newEdgeTestDB(t))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge-packages/v0.1.0/download", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "application/zip", w.Header().Get("Content-Type"))
	assert.Equal(t, `attachment; filename="edge-agent-offline-v0.1.0.zip"`, w.Header().Get("Content-Disposition"))

	sha := w.Header().Get("X-Checksum-Sha256")
	assert.Equal(t, sha, trimETag(w.Header().Get("ETag")), "ETag 携带整包 sha256")

	// zip 可读，metadata.json 版本为请求的 v0.1.0。
	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	require.NoError(t, err)
	var version string
	for _, f := range zr.File {
		if f.Name == "metadata.json" {
			rc, err := f.Open()
			require.NoError(t, err)
			var meta struct {
				Version string `json:"version"`
			}
			require.NoError(t, json.NewDecoder(rc).Decode(&meta))
			require.NoError(t, rc.Close())
			version = meta.Version
		}
	}
	assert.Equal(t, "v0.1.0", version, "zip 内 metadata 版本应与请求一致")

	// 整包 sha256 与按版本重建一致（可复算）。
	a, err := FindPackage("v0.1.0")
	require.NoError(t, err)
	_, recomputed, err := buildOfflinePackageZip(a)
	require.NoError(t, err)
	assert.Equal(t, recomputed, sha)
}

func TestDownloadPackageHandlerUnknownVersionReturns404(t *testing.T) {
	r := newManagementRouter(newEdgeTestDB(t))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge-packages/v9.9.9/download", nil))
	require.Equal(t, http.StatusNotFound, w.Code, w.Body.String())

	var resp struct {
		Status    string `json:"status"`
		ErrorType string `json:"errorType"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, "error", resp.Status)
	assert.Equal(t, "not_found", resp.ErrorType)
}