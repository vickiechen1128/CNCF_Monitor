package edge

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
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
// 该变体不关心离线包目录（传空目录），仅供退纳管 / edge-agents 用例使用。
func newManagementRouter(db *gorm.DB) *gin.Engine {
	return newManagementRouterWithDir(db, "")
}

// newManagementRouterWithDir 挂管理面路由并指定 edge-packages 构建产物目录。
func newManagementRouterWithDir(db *gorm.DB, packageDir string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterManagementRoutes(r.Group("/api/v2/platform"), db, packageDir)
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
			IsMonitored        bool                      `json:"is_monitored"`
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

// TestAgentViewDegradesPullPendingCauseWhenHeartbeatExpired 覆盖「节点已离线、配置同步却长期
// 显示同步中」：pull_pending 是「等 Agent 下次心跳拉取（准实时 ≤30s）」的进行时断言，节点离线
// （或已退纳管 retired，走同一条 stale 成因路径）后不可能推进，展示层必须失效该成因（前端回落
// 「未同步」，且不再展示「查看下发」引导）。apply_failed 是已发生的终态事实，仍透出以便排障；
// 心跳新鲜时不降级。同样只改展示结果、不改 DB 原始上报值。
func TestAgentViewDegradesPullPendingCauseWhenHeartbeatExpired(t *testing.T) {
	db := newEdgeTestDB(t)

	// 离线 + pull_pending → 成因展示态清空。
	seedMonitoredEdgeDomain(t, db, "edge-pp", "tk", "vmagent", "")
	offline := seedAgent(t, db, "edge-pp", "online", tPtr(detectNow.Add(-200*time.Second)), nil)
	require.NoError(t, db.Model(offline).Updates(map[string]interface{}{
		"config_sync_status": models.ConfigSyncStatusOutOfSync,
		"out_of_sync_cause":  models.OutOfSyncCausePullPending,
	}).Error)

	v, err := GetAgent(db, offline.ID, detectNow, DefaultOfflineThreshold)
	require.NoError(t, err)
	assert.Equal(t, AgentStatusOffline, v.Status)
	assert.Equal(t, models.ConfigSyncStatusOutOfSync, v.ConfigSyncStatus, "同步状态仍为未同步档")
	assert.Empty(t, v.OutOfSyncCause, "离线 → pull_pending 展示态失效")

	var raw models.EdgeAgent
	require.NoError(t, db.First(&raw, offline.ID).Error)
	assert.Equal(t, models.OutOfSyncCausePullPending, raw.OutOfSyncCause, "DB 原始成因不变")

	// 离线 + apply_failed → 成因保留。
	seedMonitoredEdgeDomain(t, db, "edge-af", "tk", "vmagent", "")
	failed := seedAgent(t, db, "edge-af", "online", tPtr(detectNow.Add(-200*time.Second)), nil)
	require.NoError(t, db.Model(failed).Updates(map[string]interface{}{
		"config_sync_status": models.ConfigSyncStatusOutOfSync,
		"out_of_sync_cause":  models.OutOfSyncCauseApplyFailed,
	}).Error)
	vf, err := GetAgent(db, failed.ID, detectNow, DefaultOfflineThreshold)
	require.NoError(t, err)
	assert.Equal(t, models.OutOfSyncCauseApplyFailed, vf.OutOfSyncCause, "apply_failed 属终态事实，不降级")

	// 在线 + pull_pending → 不降级（「同步中」中间态保留）。
	seedMonitoredEdgeDomain(t, db, "edge-pp-on", "tk", "vmagent", "")
	online := seedAgent(t, db, "edge-pp-on", "online", tPtr(detectNow.Add(-10*time.Second)), nil)
	require.NoError(t, db.Model(online).Updates(map[string]interface{}{
		"config_sync_status": models.ConfigSyncStatusOutOfSync,
		"out_of_sync_cause":  models.OutOfSyncCausePullPending,
	}).Error)
	vo, err := GetAgent(db, online.ID, detectNow, DefaultOfflineThreshold)
	require.NoError(t, err)
	assert.Equal(t, AgentStatusOnline, vo.Status)
	assert.Equal(t, models.OutOfSyncCausePullPending, vo.OutOfSyncCause, "在线不降级")

	// retired（已退纳管）走同一条 stale 成因路径 → 同样失效（终态不可能再推进）。
	seedMonitoredEdgeDomain(t, db, "edge-rt", "tk", "vmagent", "")
	retired := seedAgent(t, db, "edge-rt", AgentStatusRetired, tPtr(detectNow.Add(-10*time.Second)), nil)
	require.NoError(t, db.Model(retired).Updates(map[string]interface{}{
		"config_sync_status": models.ConfigSyncStatusOutOfSync,
		"out_of_sync_cause":  models.OutOfSyncCausePullPending,
	}).Error)
	vr, err := GetAgent(db, retired.ID, detectNow, DefaultOfflineThreshold)
	require.NoError(t, err)
	assert.Equal(t, AgentStatusRetired, vr.Status)
	assert.Empty(t, vr.OutOfSyncCause, "retired → pull_pending 展示态失效")
}

// TestAgentViewDegradesComponentsWhenRetired 已退纳管（retired）节点与离线同口径：历史心跳快照
// 里的组件状态（如「运行中」）对 retired 节点同样不可信（可能残留孤儿进程），展示层覆写为 unknown，
// 消除「已退纳 / 运行中」的认知冲突；DB 原始值不变。
func TestAgentViewDegradesComponentsWhenRetired(t *testing.T) {
	db := newEdgeTestDB(t)
	seedMonitoredEdgeDomain(t, db, "edge-retired-c", "tk", "vmagent", "")
	// 心跳新鲜也降级：retired 是终态，与心跳时效无关。
	a := seedAgent(t, db, "edge-retired-c", AgentStatusRetired, tPtr(detectNow.Add(-10*time.Second)), []models.EdgeComponent{
		{Type: models.ComponentTypeCollector, Name: "vmagent", Status: models.ComponentStatusRunning},
		{Type: models.ComponentTypeBlackbox, Name: "blackbox_exporter", Status: models.ComponentStatusRunning},
	})
	require.NoError(t, db.Model(a).Update("collector_status", string(models.ComponentStatusRunning)).Error)

	v, err := GetAgent(db, a.ID, detectNow, DefaultOfflineThreshold)
	require.NoError(t, err)
	assert.Equal(t, AgentStatusRetired, v.Status)
	assert.Equal(t, AgentStatusUnknown, v.CollectorStatus, "retired → 采集器状态降级 unknown")
	require.Len(t, v.Components, 2)
	for _, c := range v.Components {
		assert.Equal(t, models.ComponentStatus("unknown"), c.Status, "retired → 组件状态降级 unknown: %s", c.Type)
	}

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

// ---- T11-08 edge-packages 清单 + 下载（读构建产物目录 release_meta.json + tar.gz） ----

const testPackageFileName = "edge-sync-agent-v0.2.0-linux-amd64-20260922-121018.tar.gz"

// newFakePackageDir 造一个假离线包目录：小 tarball（几十字节）+ release_meta.json
// （字段对齐打包脚本产物，含 file）。返回目录、tarball 内容、整包 sha256。
func newFakePackageDir(t *testing.T, version string) (string, []byte, string) {
	t.Helper()
	dir := t.TempDir()
	content := []byte("fake-edge-offline-tarball-bytes-for-test")
	sum := sha256.Sum256(content)
	sha := hex.EncodeToString(sum[:])
	require.NoError(t, os.WriteFile(filepath.Join(dir, testPackageFileName), content, 0o644))
	meta := fmt.Sprintf(`{
  "version": %q,
  "file": %q,
  "size_bytes": %d,
  "sha256": %q,
  "components": [
    { "name": "edge-sync-agent", "version": %q },
    { "name": "vmagent", "version": "v1.152.0" },
    { "name": "blackbox_exporter", "version": "v0.26.0" }
  ]
}`, version, testPackageFileName, len(content), sha, version)
	require.NoError(t, os.WriteFile(filepath.Join(dir, releaseMetaFile), []byte(meta), 0o644))
	return dir, content, sha
}

// decodePackageList 解析 /edge-packages 响应信封。
func decodePackageList(t *testing.T, body []byte) (string, []PackageArtifact) {
	t.Helper()
	var resp struct {
		Status string            `json:"status"`
		Data   []PackageArtifact `json:"data"`
	}
	require.NoError(t, json.Unmarshal(body, &resp))
	return resp.Status, resp.Data
}

func TestListPackagesFromManifest(t *testing.T) {
	dir, content, sha := newFakePackageDir(t, "v0.2.0")

	pkgs, err := ListPackages(dir)
	require.NoError(t, err)
	require.Len(t, pkgs, 1, "单版本 manifest 只返回 1 条")

	p := pkgs[0]
	assert.Equal(t, "release-v0.2.0", p.ID, "清单缺 id 时按 release-<version> 派生")
	assert.Equal(t, "v0.2.0", p.Version)
	assert.Equal(t, testPackageFileName, p.File, "file 为 tarball 纯文件名")
	assert.Equal(t, sha, p.Sha256, "sha256 直接取清单值")
	assert.Equal(t, int64(len(content)), p.SizeBytes)
	assert.Equal(t, offlinePackageDownloadPathFor("v0.2.0"), p.DownloadURL)

	names := map[string]bool{}
	for _, c := range p.Components {
		names[c.Name] = true
		assert.NotEmpty(t, c.Version)
	}
	assert.True(t, names[EdgeSyncAgentComponent], "含 edge-sync-agent")
	assert.True(t, names[VMAgentComponent], "含 vmagent")
	assert.True(t, names[BlackboxComponent], "含 blackbox_exporter")

	// handler 侧同样返回 1 条且含 file。
	r := newManagementRouterWithDir(newEdgeTestDB(t), dir)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v2/platform/edge-packages", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	status, data := decodePackageList(t, w.Body.Bytes())
	assert.Equal(t, "success", status)
	require.Len(t, data, 1)
	assert.Equal(t, testPackageFileName, data[0].File)
	assert.Equal(t, sha, data[0].Sha256)
}

func TestLatestPackageIsManifestPackage(t *testing.T) {
	dir, content, sha := newFakePackageDir(t, "v0.2.0")

	latest, err := LatestPackage(dir)
	require.NoError(t, err)
	assert.Equal(t, "v0.2.0", latest.Version)
	assert.Equal(t, testPackageFileName, latest.File)
	assert.Equal(t, sha, latest.Sha256)
	assert.Equal(t, int64(len(content)), latest.SizeBytes)
	assert.Equal(t, offlinePackageDownloadPathFor("v0.2.0"), latest.DownloadURL)
}

func TestDownloadLatestPackageHandlerStreamsTarGz(t *testing.T) {
	dir, content, sha := newFakePackageDir(t, "v0.2.0")

	r := newManagementRouterWithDir(newEdgeTestDB(t), dir)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge-packages/latest/download", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "application/gzip", w.Header().Get("Content-Type"))
	assert.Equal(t, fmt.Sprintf(`attachment; filename="%s"`, testPackageFileName),
		w.Header().Get("Content-Disposition"), "用清单里的真实文件名")
	assert.Equal(t, sha, w.Header().Get("X-Checksum-Sha256"))
	assert.Equal(t, sha, trimETag(w.Header().Get("ETag")), "ETag 携带整包 sha256")
	assert.Equal(t, strconv.Itoa(len(content)), w.Header().Get("Content-Length"))
	assert.Equal(t, content, w.Body.Bytes(), "响应体等于产物文件内容")
}

// ---- T11-20 指定版本离线包下载 ----

func TestFindPackageByVersion(t *testing.T) {
	dir, content, sha := newFakePackageDir(t, "v0.2.0")

	art, err := FindPackage(dir, "v0.2.0")
	require.NoError(t, err)
	assert.Equal(t, "v0.2.0", art.Version)
	assert.Equal(t, testPackageFileName, art.File)
	assert.Equal(t, sha, art.Sha256)
	assert.Equal(t, int64(len(content)), art.SizeBytes)
	assert.Equal(t, offlinePackageDownloadPathFor("v0.2.0"), art.DownloadURL)

	// 未命中 → ErrPackageNotFound。
	_, err = FindPackage(dir, "v9.9.9")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrPackageNotFound)
}

func TestDownloadPackageHandlerStreamsTarGzForVersion(t *testing.T) {
	dir, content, sha := newFakePackageDir(t, "v0.2.0")

	r := newManagementRouterWithDir(newEdgeTestDB(t), dir)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge-packages/v0.2.0/download", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "application/gzip", w.Header().Get("Content-Type"))
	assert.Equal(t, fmt.Sprintf(`attachment; filename="%s"`, testPackageFileName),
		w.Header().Get("Content-Disposition"))
	assert.Equal(t, sha, w.Header().Get("X-Checksum-Sha256"))
	assert.Equal(t, sha, trimETag(w.Header().Get("ETag")))
	assert.Equal(t, content, w.Body.Bytes())
}

func TestDownloadPackageHandlerUnknownVersionReturns404(t *testing.T) {
	dir, _, _ := newFakePackageDir(t, "v0.2.0")

	r := newManagementRouterWithDir(newEdgeTestDB(t), dir)
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

// ---- 未打包 / 清单异常 ----

func TestListPackagesEmptyWhenNoManifest(t *testing.T) {
	dir := t.TempDir() // 空目录：未打包是正常态

	pkgs, err := ListPackages(dir)
	require.NoError(t, err, "manifest 缺失不应报错")
	assert.Empty(t, pkgs)

	r := newManagementRouterWithDir(newEdgeTestDB(t), dir)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v2/platform/edge-packages", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	status, data := decodePackageList(t, w.Body.Bytes())
	assert.Equal(t, "success", status)
	assert.Empty(t, data, "未打包返回空数组")
	assert.Contains(t, w.Body.String(), `"data":[]`, "data 应是空数组而非 null")

	// 无包时下载 → 404（latest 与按版本一致）。
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge-packages/latest/download", nil))
	assert.Equal(t, http.StatusNotFound, w2.Code)
}

// 清单存在但产物不可用（file 缺失 / 指向不存在文件 / 路径穿越归一后不存在）→ 视为无可用包。
func TestListPackagesUnavailableArtifactVariants(t *testing.T) {
	cases := map[string]string{
		"file 字段缺失": `{"version":"v0.2.0","sha256":"aa","size_bytes":1,
			"components":[{"name":"edge-sync-agent","version":"v0.2.0"}]}`,
		"file 指向不存在的文件": `{"version":"v0.2.0","file":"missing.tar.gz","sha256":"aa","size_bytes":1,
			"components":[{"name":"edge-sync-agent","version":"v0.2.0"}]}`,
		"file 路径穿越归一后无此文件": `{"version":"v0.2.0","file":"../../etc/passwd","sha256":"aa","size_bytes":1,
			"components":[{"name":"edge-sync-agent","version":"v0.2.0"}]}`,
	}
	for name, meta := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			require.NoError(t, os.WriteFile(filepath.Join(dir, releaseMetaFile), []byte(meta), 0o644))
			pkgs, err := ListPackages(dir)
			require.NoError(t, err)
			assert.Empty(t, pkgs)
		})
	}
}

// manifest 存在但 JSON 非法 → 真故障（500），不是空清单。
func TestListPackagesInvalidManifestReturns500(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, releaseMetaFile), []byte("{not-json"), 0o644))

	r := newManagementRouterWithDir(newEdgeTestDB(t), dir)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v2/platform/edge-packages", nil))
	assert.Equal(t, http.StatusInternalServerError, w.Code, w.Body.String())
}
