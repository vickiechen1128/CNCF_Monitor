package edge

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/models"
)

var edgeTestDBSeq int64

// newEdgeTestDB 打开 per-test 隔离内存 DB 并迁移 edge 协议所需模型。
// 用唯一 DSN（cache=shared + 序号）避免多个测试共享同一内存库导致数据串扰。
func newEdgeTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&edgeTestDBSeq, 1)
	dsn := fmt.Sprintf("file:edge_test_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	for _, m := range []interface{}{
		&models.NetworkDomain{},
		&models.EdgeAgent{},
		&models.EdgeHeartbeat{},
		&models.EdgeTargetSnapshot{}, // F-11：边缘 vmagent target 快照落库
		&models.ConfigVersion{},
		&models.ConfigDeployment{}, // 供 agent_pull 下发回写单测（M11 dev-feedback）
	} {
		require.NoError(t, db.AutoMigrate(m))
	}
	return db
}

func seedEdgeDomain(db *gorm.DB, id, channel, token, agentType, endpoint string) *models.NetworkDomain {
	dom := &models.NetworkDomain{
		ID:                 id,
		Name:               "nd-" + id,
		DomainType:         models.DomainTypeEdge,
		Channel:            models.ChannelType(channel),
		Token:              token,
		AgentType:          models.AgentType(agentType),
		CenterEndpoint:     endpoint,
		TenantID:           "tenant-1",
		Status:             models.DomainStatusEnabled,
		RegistrationStatus: models.RegistrationStatusMonitored,
	}
	_ = db.Create(dom).Error
	return dom
}

func seedConfigVersion(db *gorm.DB, domainID, promYML, rulesYML, blackboxYML string, targets map[string]string, createdAt time.Time) *models.ConfigVersion {
	tj, _ := json.Marshal(targets)
	v := &models.ConfigVersion{
		NetworkDomainID: domainID,
		PrometheusYml:   promYML,
		RulesYml:        rulesYML,
		BlackboxYml:     blackboxYML,
		TargetsFiles:    string(tj),
	}
	v.CreatedAt = createdAt
	_ = db.Create(v).Error
	return v
}

func newEdgeRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	grp := r.Group("/api/v2/platform/edge")
	RegisterRoutes(grp, db)
	return r
}

// --- T11-04 service 级：config_changed 判定 / 自动注册 / 下载地址合成 ---

func TestHeartbeatConfigChanged_DownloadURL_AndAutoRegister(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-cloud-a", "agent_pull", "tok-abc", "vmagent", "http://center:8080")

	seedConfigVersion(db, dom.ID,
		"global:\n  scrape_interval: 15s\n",
		"groups: []\n", "",
		map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`},
		time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC))

	svc := NewHeartbeatService(db)

	// 上报版本与中心一致 → config_changed=false，并自动注册 EdgeAgent。
	req := &HeartbeatRequest{
		NetworkDomainID:      dom.ID,
		AgentType:            models.AgentTypeVMAgent,
		Version:              "v1.2.0",
		ConfigVersion:        "20260724-120000",
		QueueBacklogBytes:    2048,
		RemoteWriteQueueSize: 64,
		Hostname:             "edge01",
		Ip:                   "10.0.2.15",
		Components:           []models.EdgeComponent{{Type: models.ComponentTypeCollector, Name: "vmagent", Status: models.ComponentStatusRunning}},
	}
	resp, err := svc.Handle(dom, req, time.Date(2026, 9, 18, 8, 0, 0, 0, time.UTC), "http://center:8080")
	require.NoError(t, err)
	assert.False(t, resp.ConfigChanged, "版本一致应 config_changed=false")
	assert.Equal(t, "20260724-120000", resp.ConfigVersion)
	assert.Equal(t, "http://center:8080/api/v2/platform/edge/config?network_domain="+dom.ID, resp.ConfigDownloadURL, "下载地址应为绝对地址")

	var agent models.EdgeAgent
	require.NoError(t, db.Where("network_domain_id = ?", dom.ID).First(&agent).Error)
	assert.Equal(t, models.AgentTypeVMAgent, agent.AgentType, "缺失实例应自动注册")
	assert.Equal(t, "edge01", agent.Hostname)
	assert.Len(t, agent.Components, 1)
	assert.Equal(t, models.ConfigSyncStatusInSync, agent.ConfigSyncStatus)

	// 上报版本过旧 → config_changed=true，out_of_sync_cause=pull_pending。
	req2 := &HeartbeatRequest{NetworkDomainID: dom.ID, ConfigVersion: "20260723-090000"}
	resp2, err := svc.Handle(dom, req2, time.Date(2026, 9, 18, 8, 1, 0, 0, time.UTC), "http://center:8080")
	require.NoError(t, err)
	assert.True(t, resp2.ConfigChanged, "版本不一致应 config_changed=true")
	assert.Equal(t, "20260724-120000", resp2.ConfigVersion)

	require.NoError(t, db.Where("network_domain_id = ?", dom.ID).First(&agent).Error)
	assert.Equal(t, models.ConfigSyncStatusOutOfSync, agent.ConfigSyncStatus)
	assert.Equal(t, models.OutOfSyncCausePullPending, agent.OutOfSyncCause)
}

// TestHeartbeatApplyFailedCause 覆盖 D-2 三态判定（正例）：Agent 已拉到最新版本但应用
// 失败（回滚后仍运行上一版本）时，中心必须落 out_of_sync + apply_failed（「同步失败」），
// 而非误判为 pull_pending（「等待拉取」），并保存失败文本与失败版本。
func TestHeartbeatApplyFailedCause(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "nd-apply-failed", "agent_pull", "tok-af", "vmagent", "http://center:8080")
	// latest = 20260924-100000
	seedConfigVersion(db, dom.ID,
		"global:\n  scrape_interval: 15s\n", "groups: []\n", "",
		map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`},
		time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC))

	svc := NewHeartbeatService(db)
	req := &HeartbeatRequest{
		NetworkDomainID:          dom.ID,
		AgentType:                models.AgentTypeVMAgent,
		ConfigVersion:            "20260922-091425", // 应用失败后回滚到的上一可用版本
		ConfigApplyError:         "deployer: targets app.json: empty array",
		ConfigApplyFailedVersion: "20260924-100000", // == 中心最新版本
	}
	resp, err := svc.Handle(dom, req, time.Date(2026, 9, 24, 10, 5, 0, 0, time.UTC), "http://center:8080")
	require.NoError(t, err)
	require.True(t, resp.ConfigChanged, "版本不一致应 config_changed=true")

	var agent models.EdgeAgent
	require.NoError(t, db.Where("network_domain_id = ?", dom.ID).First(&agent).Error)
	assert.Equal(t, models.ConfigSyncStatusOutOfSync, agent.ConfigSyncStatus)
	assert.Equal(t, models.OutOfSyncCauseApplyFailed, agent.OutOfSyncCause, "失败版本==最新 → apply_failed")
	assert.Equal(t, req.ConfigApplyError, agent.ConfigApplyError, "失败原因应落库")
	assert.Equal(t, "20260924-100000", agent.ConfigApplyFailedVersion)
}

// TestHeartbeatApplyFailedOlderVersionStaysPullPending 覆盖 D-2 三态判定（边界 + 复位）：
// 失败版本 ≠ 中心最新版本（已有更新版本待拉取）时仍按 pull_pending，不用陈旧失败覆盖真因；
// 随后 Agent 拉齐并成功应用最新版本 → in_sync，且失败原因与成因均被清空。
func TestHeartbeatApplyFailedOlderVersionStaysPullPending(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "nd-apply-old", "agent_pull", "tok-ao", "vmagent", "http://center:8080")
	seedConfigVersion(db, dom.ID,
		"global:\n  scrape_interval: 15s\n", "groups: []\n", "",
		map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`},
		time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC))

	svc := NewHeartbeatService(db)
	req := &HeartbeatRequest{
		NetworkDomainID:          dom.ID,
		AgentType:                models.AgentTypeVMAgent,
		ConfigVersion:            "20260922-091425",
		ConfigApplyError:         "deployer: targets app.json: empty array",
		ConfigApplyFailedVersion: "20260923-080000", // ≠ 最新（20260924-100000）
	}
	_, err := svc.Handle(dom, req, time.Date(2026, 9, 24, 10, 5, 0, 0, time.UTC), "http://center:8080")
	require.NoError(t, err)

	var agent models.EdgeAgent
	require.NoError(t, db.Where("network_domain_id = ?", dom.ID).First(&agent).Error)
	assert.Equal(t, models.ConfigSyncStatusOutOfSync, agent.ConfigSyncStatus)
	assert.Equal(t, models.OutOfSyncCausePullPending, agent.OutOfSyncCause, "失败版本≠最新 → 仍 pull_pending")

	// 应用成功（版本一致、不再上报错误）→ in_sync，错误文本与成因清空。
	req2 := &HeartbeatRequest{
		NetworkDomainID: dom.ID,
		AgentType:       models.AgentTypeVMAgent,
		ConfigVersion:   "20260924-100000",
	}
	_, err = svc.Handle(dom, req2, time.Date(2026, 9, 24, 10, 10, 0, 0, time.UTC), "http://center:8080")
	require.NoError(t, err)

	require.NoError(t, db.Where("network_domain_id = ?", dom.ID).First(&agent).Error)
	assert.Equal(t, models.ConfigSyncStatusInSync, agent.ConfigSyncStatus)
	assert.Empty(t, agent.OutOfSyncCause, "in_sync 应清空成因")
	assert.Empty(t, agent.ConfigApplyError, "应用成功应清空失败原因")
	assert.Empty(t, agent.ConfigApplyFailedVersion)
}

// TestHeartbeatRecordsLastConfigPullOnVersionAdvance 覆盖 last_config_pull 写入方（此前该字段
// model/DTO/前端类型齐备但全链路无写入方）：仅在「上报版本推进到最新已确认版本」这一拉取事件
// 首次出现时留痕（中心接收时间为准），同版本持续心跳不刷新，避免「恒定显示刚刚拉取」。
func TestHeartbeatRecordsLastConfigPullOnVersionAdvance(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "nd-pull", "agent_pull", "tok-pull", "vmagent", "http://center:8080")
	// 中心最新版本 20260924-100000
	seedConfigVersion(db, dom.ID,
		"global:\n  scrape_interval: 15s\n", "groups: []\n", "",
		map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`},
		time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC))

	svc := NewHeartbeatService(db)
	hb := func(version string, at time.Time) {
		t.Helper()
		_, err := svc.Handle(dom, &HeartbeatRequest{
			NetworkDomainID: dom.ID,
			AgentType:       models.AgentTypeVMAgent,
			ConfigVersion:   version,
		}, at, "http://center:8080")
		require.NoError(t, err)
	}
	load := func() *models.EdgeAgent {
		t.Helper()
		var a models.EdgeAgent
		require.NoError(t, db.Where("network_domain_id = ?", dom.ID).First(&a).Error)
		return &a
	}

	// 首次心跳（自动注册）报旧版本：中心尚未观测到任何拉取事件 → 不留痕。
	t1 := time.Date(2026, 9, 24, 10, 1, 0, 0, time.UTC)
	hb("20260922-091425", t1)
	assert.Nil(t, load().LastConfigPull, "未观测到拉取事件 → 不写拉取时间")

	// 版本推进到最新已确认版本 → 记一次拉取。
	t2 := t1.Add(30 * time.Second)
	hb("20260924-100000", t2)
	got := load()
	require.NotNil(t, got.LastConfigPull, "版本推进 → 应留痕")
	assert.True(t, t2.Equal(*got.LastConfigPull), "拉取时间取中心接收时间")

	// 同版本继续心跳 → 不刷新。
	t3 := t2.Add(time.Hour)
	hb("20260924-100000", t3)
	assert.True(t, t2.Equal(*load().LastConfigPull), "同版本心跳不刷新拉取时间")
}

// TestHeartbeatRecordsLastConfigPullOnApplyFailed 覆盖第二条拉取线索（D-2 场景）：Agent 已拉包
// 但应用失败并回滚，上报版本停留在旧值——此时中心仍应留痕（确实发生过拉取），但同一失败版本的
// 重复心跳不得反复刷新时间。
func TestHeartbeatRecordsLastConfigPullOnApplyFailed(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "nd-pull-af", "agent_pull", "tok-paf", "vmagent", "http://center:8080")
	seedConfigVersion(db, dom.ID,
		"global:\n  scrape_interval: 15s\n", "groups: []\n", "",
		map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`},
		time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC))

	svc := NewHeartbeatService(db)
	failedReq := func() *HeartbeatRequest {
		return &HeartbeatRequest{
			NetworkDomainID:          dom.ID,
			AgentType:                models.AgentTypeVMAgent,
			ConfigVersion:            "20260922-091425", // 回滚后的上一可用版本
			ConfigApplyError:         "deployer: targets node.json: empty array",
			ConfigApplyFailedVersion: "20260924-100000", // == 中心最新版本
		}
	}
	t1 := time.Date(2026, 9, 24, 10, 5, 0, 0, time.UTC)
	_, err := svc.Handle(dom, failedReq(), t1, "http://center:8080")
	require.NoError(t, err)

	var agent models.EdgeAgent
	require.NoError(t, db.Where("network_domain_id = ?", dom.ID).First(&agent).Error)
	require.NotNil(t, agent.LastConfigPull, "已拉包但应用失败 → 也应留痕")
	assert.True(t, t1.Equal(*agent.LastConfigPull))

	// 同一失败版本的后续心跳 → 不刷新（事件未再次发生）。
	t2 := t1.Add(time.Hour)
	_, err = svc.Handle(dom, failedReq(), t2, "http://center:8080")
	require.NoError(t, err)
	require.NoError(t, db.Where("network_domain_id = ?", dom.ID).First(&agent).Error)
	assert.True(t, t1.Equal(*agent.LastConfigPull), "同一失败版本重复上报不刷新")
}

func TestHeartbeatService_NoConfigVersion(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "nd-empty", "agent_pull", "tok-xyz", "", "http://center:8080")
	svc := NewHeartbeatService(db)
	resp, err := svc.Handle(dom, &HeartbeatRequest{NetworkDomainID: dom.ID, ConfigVersion: ""}, time.Now(), "http://center:8080")
	require.NoError(t, err)
	assert.False(t, resp.ConfigChanged)
	assert.Empty(t, resp.ConfigVersion)
}

// TestHeartbeatHandlerConfigDownloadURL 覆盖 config_download_url 修正：
// 经反代（Cloudflare Tunnel）心跳时，请求 Request.Host 为 localhost，但
// X-Forwarded-Host/Proto 携带公网出处，agent 拿到的下载地址必须指向公网地址，
// 绝不能回落成 localhost（否则腾讯云 agent 拉包 `unsupported protocol scheme ""`）。
func TestHeartbeatHandlerConfigDownloadURL(t *testing.T) {
	db := newEdgeTestDB(t)
	seedEdgeDomain(db, "mc-edge-debug", "agent_pull", "tok-debug", "vmagent", "")
	r := newEdgeRouter(db)

	req := httptest.NewRequest(http.MethodPost, "/api/v2/platform/edge/heartbeat",
		strings.NewReader(`{"network_domain_id":"mc-edge-debug","config_version":"20260724-120000","agent_type":"vmagent"}`))
	req.Header.Set("Authorization", "Bearer tok-debug")
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "suggested-toys.example.com")
	req.Host = "localhost:8080" // 模拟 cloudflared 转发后的本地 Host

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	var env struct {
		Data HeartbeatResponse `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &env))
	assert.Equal(t, "https://suggested-toys.example.com/api/v2/platform/edge/config?network_domain=mc-edge-debug",
		env.Data.ConfigDownloadURL, "应优先用 X-Forwarded-Proto/Host 拼绝对地址")
}

// TestRequestAuthorityFallsBackToRequestHost 验证无转发头时回落请求 Host。
func TestRequestAuthorityFallsBackToRequestHost(t *testing.T) {
	r := gin.New()
	r.GET("/x", func(c *gin.Context) {
		c.String(http.StatusOK, requestAuthority(c))
	})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Host = "10.8.0.5:8443"
	r.ServeHTTP(w, req)
	assert.Equal(t, "http://10.8.0.5:8443", w.Body.String())
}

// --- T11-04/T11-03 handler 级：token 鉴定 / 网域缺失 / local 拒绝 ---

func TestHeartbeatUnauthorizedMissingIdentity(t *testing.T) {
	db := newEdgeTestDB(t)
	seedEdgeDomain(db, "gov-x", "agent_pull", "tok-x", "vmagent", "")
	r := newEdgeRouter(db)

	// 缺 token。
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/v2/platform/edge/heartbeat",
		strings.NewReader(`{"network_domain_id":"gov-x","config_version":"x"}`)))
	assert.Equal(t, http.StatusUnauthorized, w.Code)

	// token 不匹配。
	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/v2/platform/edge/heartbeat",
		strings.NewReader(`{"network_domain_id":"gov-x","config_version":"x"}`))
	req2.Header.Set("Authorization", "Bearer wrong-token")
	r.ServeHTTP(w2, req2)
	assert.Equal(t, http.StatusUnauthorized, w2.Code)
}

func TestHeartbeatLocalDomainRejected(t *testing.T) {
	db := newEdgeTestDB(t)
	seedEdgeDomain(db, "default", "local", "tok-local", "", "")
	r := newEdgeRouter(db)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/platform/edge/heartbeat",
		strings.NewReader(`{"network_domain_id":"default","config_version":"x"}`))
	req.Header.Set("Authorization", "Bearer tok-local")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusConflict, w.Code, "local 通道网域不走 edge 协议 → 409")
}

// --- T11-05 config zip：5 结构 + checksum 可复算 ---

func TestBuildConfigZipStructureAndChecksumRecomputable(t *testing.T) {
	db := newEdgeTestDB(t)
	promYML := "global:\n  scrape_interval: 15s\nscrape_configs:\n  - job_name: node\n"
	rulesYML := "groups:\n  - name: x\n    rules: []\n"
	blackboxYML := "modules:\n  http_2xx:\n    prober: http\n"
	targets := map[string]string{
		"node.json": `[{"targets":["10.0.1.10:9100"],"labels":{"job":"node"}}]`,
		"http.json": `[{"targets":["https://api.example.com/health"]}]`,
	}
	v := seedConfigVersion(db, "gov-a", promYML, rulesYML, blackboxYML, targets,
		time.Date(2026, 7, 24, 12, 15, 0, 0, time.UTC))

	zipData, checksum, err := BuildConfigZip(v, models.AgentTypeVMAgent, "")
	require.NoError(t, err)
	require.NotEmpty(t, checksum)

	// 应包含 5 类条目。
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	require.NoError(t, err)
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	assert.True(t, names["prometheus.yml"], "应含 prometheus.yml")
	assert.True(t, names["targets/node.json"], "应含 targets/node.json")
	assert.True(t, names["targets/http.json"], "应含 targets/http.json")
	assert.True(t, names["blackbox.yml"], "应含 blackbox.yml")
	assert.True(t, names["rules.yml"], "应含 rules.yml")
	assert.True(t, names["metadata.json"], "应含 metadata.json")
	assert.Equal(t, 6, len(zr.File))

	// metadata.json 校验字段。
	var meta metadata
	for _, f := range zr.File {
		if f.Name == "metadata.json" {
			rc, _ := f.Open()
			require.NoError(t, json.NewDecoder(rc).Decode(&meta))
			_ = rc.Close()
		}
	}
	assert.Equal(t, "20260724-121500", meta.ConfigVersion)
	assert.Equal(t, "vmagent", meta.AgentType)
	assert.Equal(t, checksum, meta.Checksum)

	// 联合 checksum 可复算一致。
	recomputed := packageChecksum(promYML, rulesYML, blackboxYML, targetsCarrier(targets))
	assert.Equal(t, checksum, recomputed, "checksum 应可复算一致")
}

func TestBuildConfigZipOptionalEntries(t *testing.T) {
	db := newEdgeTestDB(t)
	// 无 rules/blackbox 时不应生成对应条目。
	v := seedConfigVersion(db, "gov-b",
		"global:\n  scrape_interval: 15s\n", "", "",
		map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`},
		time.Date(2026, 7, 24, 10, 0, 0, 0, time.UTC))
	zipData, _, err := BuildConfigZip(v, models.AgentTypeVMAgent, "")
	require.NoError(t, err)
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	require.NoError(t, err)
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	assert.False(t, names["rules.yml"], "无 rules 不应生成 rules.yml")
	assert.False(t, names["blackbox.yml"], "无 blackbox 不应生成 blackbox.yml")
	assert.True(t, names["prometheus.yml"])
	assert.True(t, names["targets/node.json"])
	assert.True(t, names["metadata.json"])
}

// TestBuildConfigZipRemoteWriteURL 断言 metadata.json 承载 remote_write_url：
// 网域显式配置时下发（T11-G1-02 方案 B），未配置时省略（omitempty）。
func TestBuildConfigZipRemoteWriteURL(t *testing.T) {
	db := newEdgeTestDB(t)
	seed := func(domainID string) *models.ConfigVersion {
		return seedConfigVersion(db, domainID, "global:\n  scrape_interval: 15s\n", "", "",
			map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`},
			time.Date(2026, 7, 24, 12, 15, 0, 0, time.UTC))
	}

	readMeta := func(zipData []byte) metadata {
		zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
		require.NoError(t, err)
		var m metadata
		for _, f := range zr.File {
			if f.Name == "metadata.json" {
				rc, _ := f.Open()
				require.NoError(t, json.NewDecoder(rc).Decode(&m))
				_ = rc.Close()
			}
		}
		return m
	}

	// 显式配置 RemoteWriteURL → metadata 下发该地址。
	with := seed("gov-rw-with")
	zipWith, _, err := BuildConfigZip(with, models.AgentTypeVMAgent, "http://10.0.0.1:8428/api/v1/write")
	require.NoError(t, err)
	assert.Equal(t, "http://10.0.0.1:8428/api/v1/write", readMeta(zipWith).RemoteWriteURL)

	// 未配置（空串）→ metadata 省略该字段。
	without := seed("gov-rw-without")
	zipWithout, _, err := BuildConfigZip(without, models.AgentTypeVMAgent, "")
	require.NoError(t, err)
	assert.Empty(t, readMeta(zipWithout).RemoteWriteURL, "未显式配置应省略 remote_write_url")

	// 下发地址不影响联合 checksum 可复算（metadata 自身不计入 checksum）。
	recomputed := packageChecksum(with.PrometheusYml, with.RulesYml, with.BlackboxYml, targetsCarrier(map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`}))
	_, checksum, _ := BuildConfigZip(with, models.AgentTypeVMAgent, "http://10.0.0.1:8428/api/v1/write")
	assert.Equal(t, recomputed, checksum, "remote_write_url 不应影响联合 checksum")
}

// --- T11-05 config handler：zip 200 / 304 / 404 / 401 ---

func TestConfigHandlerServeZipAnd304(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-c", "agent_pull", "tok-c", "vmagent", "http://center:8080")
	seedConfigVersion(db, dom.ID, "global:\n  scrape_interval: 15s\n", "", "",
		map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`},
		time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC))
	r := newEdgeRouter(db)

	// 初始拉取（无 config_version）→ 200 zip。
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge/config?network_domain="+dom.ID, nil)
	req.Header.Set("Authorization", "Bearer tok-c")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "application/zip", w.Header().Get("Content-Type"))
	assert.Equal(t, fmt.Sprintf(`attachment; filename="edge-config-%s.zip"`, dom.ID), w.Header().Get("Content-Disposition"))
	// 携带匹配 ETag 再拉 → 304。
	etag := w.Header().Get("ETag")
	assert.NotEmpty(t, etag)

	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge/config?network_domain="+dom.ID+"&config_version=20260724-120000", nil)
	req2.Header.Set("Authorization", "Bearer tok-c")
	r.ServeHTTP(w2, req2)
	assert.Equal(t, http.StatusNotModified, w2.Code, "版本一致应 304")

	// 通过 If-None-Match 也 304。
	w3 := httptest.NewRecorder()
	req3 := httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge/config?network_domain="+dom.ID, nil)
	req3.Header.Set("Authorization", "Bearer tok-c")
	req3.Header.Set("If-None-Match", etag)
	r.ServeHTTP(w3, req3)
	assert.Equal(t, http.StatusNotModified, w3.Code)

	_ = etag
}

func TestConfigHandlerNoVersionNotFound(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-empty", "agent_pull", "tok-e", "", "")
	r := newEdgeRouter(db)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge/config?network_domain="+dom.ID, nil)
	req.Header.Set("Authorization", "Bearer tok-e")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusNotFound, w.Code, "尚无配置版本应 404")
}

// TestHeartbeatWritebackAgentPullDeployment 验证 M11 dev-feedback：agent_pull 通道的
// pending 下发记录在 agent 心跳确认已同步到对应版本后被回写成 success。
func TestHeartbeatWritebackAgentPullDeployment(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-wb", "agent_pull", "tok-wb", "vmagent", "")
	createdAt := time.Date(2026, 9, 21, 4, 47, 56, 0, time.UTC)
	v := seedConfigVersion(db, dom.ID, "global:\n  scrape_interval: 15s\n", "", "",
		map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`}, createdAt)

	// 预置一条对应版本的 pending 下发记录（模拟 confirm 时 agent_pull 占位）。
	dep := &models.ConfigDeployment{
		DeploymentID:    "deploy-20260921-001",
		NetworkDomainID: dom.ID,
		ConfigVersionID: fmt.Sprint(v.ID),
		SourceChangeNo:  "CHG-20260921-005",
		Channel:         models.ChannelTypeAgentPull,
		Status:          models.DeploymentStatusPending,
	}
	require.NoError(t, db.Create(dep).Error)

	r := newEdgeRouter(db)
	body := fmt.Sprintf(`{"network_domain_id":"%s","agent_type":"vmagent","config_version":"%s"}`,
		dom.ID, configVersionString(v))
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/platform/edge/heartbeat",
		strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer tok-wb")
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	var got models.ConfigDeployment
	require.NoError(t, db.Where("deployment_id = ?", dep.DeploymentID).First(&got).Error)
	assert.Equal(t, models.DeploymentStatusSuccess, got.Status, "agent 已同步应回写 success")
	assert.NotNil(t, got.CompletedAt, "应记录完成时间")

	// 尚未同步（上报旧 config_version）→ pending 不应被翻写。
	v2Created := createdAt.Add(time.Minute)
	v2 := seedConfigVersion(db, dom.ID, "global:\n  scrape_interval: 15s\n  v2: true\n", "", "",
		map[string]string{}, v2Created)
	dep2 := &models.ConfigDeployment{
		DeploymentID:    "deploy-20260921-002",
		NetworkDomainID: dom.ID,
		ConfigVersionID: fmt.Sprint(v2.ID),
		SourceChangeNo:  "CHG-20260921-006",
		Channel:         models.ChannelTypeAgentPull,
		Status:          models.DeploymentStatusPending,
	}
	require.NoError(t, db.Create(dep2).Error)

	// 上报仍是旧版本 → changed=true → 不应回写。
	r2 := newEdgeRouter(db)
	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/v2/platform/edge/heartbeat",
		strings.NewReader(body))
	req2.Header.Set("Authorization", "Bearer tok-wb")
	r2.ServeHTTP(w2, req2)
	require.Equal(t, http.StatusOK, w2.Code)

	var stillPending models.ConfigDeployment
	require.NoError(t, db.Where("deployment_id = ?", dep2.DeploymentID).First(&stillPending).Error)
	assert.Equal(t, models.DeploymentStatusPending, stillPending.Status, "未同步版本不应被翻写")
}

// TestHeartbeatRequestDecodesEdgeTargets 校验中心契约可反序列化 agent 上报的
// targets 快照字段（方案 B，本轮仅透传占位，不落库）。字段名须与 agent 侧
// contract.EdgeTargetSnapshot 对齐。
func TestHeartbeatRequestDecodesEdgeTargets(t *testing.T) {
	var req HeartbeatRequest
	raw := `{
		"network_domain_id":"gov-cloud-a",
		"agent_type":"vmagent",
		"targets":[
			{"job":"node","instance":"10.0.0.1:9100","resource_id":"res-1","health":"up",
			 "last_scrape":"2026-09-18T12:00:00Z","last_error":"","scrape_duration_seconds":1.23}
		]
	}`
	require.NoError(t, json.Unmarshal([]byte(raw), &req))
	require.Len(t, req.Targets, 1)
	assert.Equal(t, "node", req.Targets[0].Job)
	assert.Equal(t, "10.0.0.1:9100", req.Targets[0].Instance)
	assert.Equal(t, "res-1", req.Targets[0].ResourceID)
	assert.Equal(t, "up", req.Targets[0].Health)
	assert.Equal(t, "2026-09-18T12:00:00Z", req.Targets[0].LastScrape)
	assert.Equal(t, 1.23, req.Targets[0].ScrapeDurationSeconds)
}

// --- F-11：中心侧落库边缘 vmagent target 快照（clear-then-insert + upsert 覆盖） ---

func countEdgeTargetSnapshots(t *testing.T, db *gorm.DB, domainID string) int64 {
	t.Helper()
	var n int64
	require.NoError(t, db.Model(&models.EdgeTargetSnapshot{}).
		Where("network_domain_id = ?", domainID).Count(&n).Error)
	return n
}

// TestHeartbeatPersistsTargetSnapshots 覆盖「targets 落库成功」：心跳携带 targets →
// 写入 edge_target_snapshots，字段与上报契约对齐；同轮内同 (job,instance) 去重不重复落。
func TestHeartbeatPersistsTargetSnapshots(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-ts-1", "agent_pull", "tok-ts-1", "vmagent", "http://center:8080")
	svc := NewHeartbeatService(db)
	now := time.Date(2026, 9, 21, 8, 0, 0, 0, time.UTC)
	req := &HeartbeatRequest{
		NetworkDomainID: dom.ID,
		AgentType:       models.AgentTypeVMAgent,
		Targets: []EdgeTargetSnapshot{
			{Job: "node", Instance: "10.0.0.1:9100", ResourceID: "res-1", Health: "up",
				LastScrape: "2026-09-21T07:59:00Z", LastError: "", ScrapeDurationSeconds: 1.23},
			// 同 (job,instance) 重复 → 应去重为 1 行。
			{Job: "node", Instance: "10.0.0.1:9100", Health: "up"},
			{Job: "node", Instance: "10.0.0.2:9100", Health: "down", LastError: "connect refused"},
		},
	}
	_, err := svc.Handle(dom, req, now, "http://center:8080")
	require.NoError(t, err)
	require.Equal(t, int64(2), countEdgeTargetSnapshots(t, db, dom.ID), "应落 2 条（同键去重）")

	got := map[string]models.EdgeTargetSnapshot{}
	var rows []models.EdgeTargetSnapshot
	require.NoError(t, db.Where("network_domain_id = ?", dom.ID).Find(&rows).Error)
	for _, r := range rows {
		got[r.Instance] = r
	}
	assert.Equal(t, "up", got["10.0.0.1:9100"].Health)
	assert.Equal(t, "res-1", got["10.0.0.1:9100"].ResourceID)
	assert.Equal(t, 1.23, got["10.0.0.1:9100"].ScrapeDurationSeconds)
	assert.Equal(t, "2026-09-21T07:59:00Z", got["10.0.0.1:9100"].LastScrape)
	assert.WithinDuration(t, now, got["10.0.0.1:9100"].LastReportAt, time.Second)
	assert.Equal(t, "down", got["10.0.0.2:9100"].Health)
	assert.Equal(t, "connect refused", got["10.0.0.2:9100"].LastError)
	assert.NotZero(t, got["10.0.0.1:9100"].EdgeAgentID, "应记录 agent 维度")
}

// TestHeartbeatTargetUpsertOverwritesSameKey 覆盖「同 agent 同 (job,instance) 二次心跳
// upsert 覆盖」：行数不增、target 状态被本轮覆盖。
func TestHeartbeatTargetUpsertOverwritesSameKey(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-ts-2", "agent_pull", "tok-ts-2", "vmagent", "http://center:8080")
	svc := NewHeartbeatService(db)
	req := &HeartbeatRequest{NetworkDomainID: dom.ID, AgentType: models.AgentTypeVMAgent,
		Targets: []EdgeTargetSnapshot{{Job: "node", Instance: "10.0.0.1:9100", Health: "up", LastScrape: "2026-09-21T07:59:00Z"}}}
	_, err := svc.Handle(dom, req, time.Date(2026, 9, 21, 8, 0, 0, 0, time.UTC), "http://center:8080")
	require.NoError(t, err)

	req2 := &HeartbeatRequest{NetworkDomainID: dom.ID, AgentType: models.AgentTypeVMAgent,
		Targets: []EdgeTargetSnapshot{{Job: "node", Instance: "10.0.0.1:9100", Health: "down", LastScrape: "2026-09-21T07:58:00Z", LastError: "connect refused"}}}
	_, err = svc.Handle(dom, req2, time.Date(2026, 9, 21, 8, 1, 0, 0, time.UTC), "http://center:8080")
	require.NoError(t, err)

	require.Equal(t, int64(1), countEdgeTargetSnapshots(t, db, dom.ID), "同键覆盖更新，行数应仍为 1")
	var row models.EdgeTargetSnapshot
	require.NoError(t, db.Where("network_domain_id = ? AND job = ? AND instance = ?",
		dom.ID, "node", "10.0.0.1:9100").First(&row).Error)
	assert.Equal(t, "down", row.Health)
	assert.Equal(t, "connect refused", row.LastError)
	assert.WithinDuration(t, time.Date(2026, 9, 21, 8, 1, 0, 0, time.UTC), row.LastReportAt, time.Second,
		"last_report_at 应更新为本轮接收时间")
}

// TestHeartbeatTargetClearOldSnapshots 覆盖「快照清理/有效期逻辑」：二次心跳 target 集合
// 变化，旧的过期快照被清理，表仅存本轮集合（无堆积）。
func TestHeartbeatTargetClearOldSnapshots(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-ts-3", "agent_pull", "tok-ts-3", "vmagent", "http://center:8080")
	svc := NewHeartbeatService(db)
	req := &HeartbeatRequest{NetworkDomainID: dom.ID, AgentType: models.AgentTypeVMAgent,
		Targets: []EdgeTargetSnapshot{{Job: "node", Instance: "10.0.0.1:9100", Health: "up"}, {Job: "node", Instance: "10.0.0.2:9100", Health: "down"}}}
	_, err := svc.Handle(dom, req, time.Now(), "http://center:8080")
	require.NoError(t, err)
	require.Equal(t, int64(2), countEdgeTargetSnapshots(t, db, dom.ID))

	req2 := &HeartbeatRequest{NetworkDomainID: dom.ID, AgentType: models.AgentTypeVMAgent,
		Targets: []EdgeTargetSnapshot{{Job: "web", Instance: "10.0.0.9:9114", Health: "up"}}}
	_, err = svc.Handle(dom, req2, time.Now(), "http://center:8080")
	require.NoError(t, err)
	require.Equal(t, int64(1), countEdgeTargetSnapshots(t, db, dom.ID), "旧快照应被清理，仅存本轮")
	var row models.EdgeTargetSnapshot
	require.NoError(t, db.Where("network_domain_id = ?", dom.ID).First(&row).Error)
	assert.Equal(t, "web", row.Job)
	assert.Equal(t, "10.0.0.9:9114", row.Instance)
}

// TestHeartbeatEmptyTargetsNoDirtyData 覆盖「targets 为空时不落脏数据」：空 targets 心跳
// 不新增行，且不清空上轮快照（保住「真实为空」与「获取失败」的分野）。
func TestHeartbeatEmptyTargetsNoDirtyData(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-ts-4", "agent_pull", "tok-ts-4", "vmagent", "http://center:8080")
	svc := NewHeartbeatService(db)
	req := &HeartbeatRequest{NetworkDomainID: dom.ID, AgentType: models.AgentTypeVMAgent,
		Targets: []EdgeTargetSnapshot{{Job: "node", Instance: "10.0.0.1:9100", Health: "up"}}}
	_, err := svc.Handle(dom, req, time.Now(), "http://center:8080")
	require.NoError(t, err)
	require.Equal(t, int64(1), countEdgeTargetSnapshots(t, db, dom.ID))

	empty := &HeartbeatRequest{NetworkDomainID: dom.ID, AgentType: models.AgentTypeVMAgent, Targets: nil}
	_, err = svc.Handle(dom, empty, time.Now(), "http://center:8080")
	require.NoError(t, err)
	require.Equal(t, int64(1), countEdgeTargetSnapshots(t, db, dom.ID), "空 targets 不应新增也不应清空既有快照")
}

// TestHeartbeatTargetPersistenceIndependent 覆盖「心跳失败不影响落库独立性」：极简心跳
// （无 config_version/components/version）targets 仍独立落库，落库走独立事务、不依赖
// 其余心跳字段；返回成功响应不受影响。
func TestHeartbeatTargetPersistenceIndependent(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-ts-5", "agent_pull", "tok-ts-5", "", "http://center:8080")
	svc := NewHeartbeatService(db)
	req := &HeartbeatRequest{NetworkDomainID: dom.ID,
		Targets: []EdgeTargetSnapshot{{Job: "mem", Instance: "10.0.0.55:9120", Health: "up"}}}
	resp, err := svc.Handle(dom, req, time.Now(), "http://center:8080")
	require.NoError(t, err)
	assert.NotNil(t, resp)
	require.Equal(t, int64(1), countEdgeTargetSnapshots(t, db, dom.ID), "极简心跳也应落库 targets")
}

// TestHeartbeatTargetTruncatesAtMax 覆盖「心跳体积上限截断」：targets 超过上限时只落
// 前 maxSnapshotsPerHeartbeat 条，不因超量入库而膨胀。
func TestHeartbeatTargetTruncatesAtMax(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-ts-6", "agent_pull", "tok-ts-6", "vmagent", "http://center:8080")
	svc := NewHeartbeatService(db)
	ts := make([]EdgeTargetSnapshot, 0, maxSnapshotsPerHeartbeat+8)
	for i := 0; i < maxSnapshotsPerHeartbeat+8; i++ {
		ts = append(ts, EdgeTargetSnapshot{Job: "j", Instance: fmt.Sprintf("10.0.0.%d:9100", i), Health: "up"})
	}
	req := &HeartbeatRequest{NetworkDomainID: dom.ID, AgentType: models.AgentTypeVMAgent, Targets: ts}
	_, err := svc.Handle(dom, req, time.Now(), "http://center:8080")
	require.NoError(t, err)
	require.Equal(t, int64(maxSnapshotsPerHeartbeat), countEdgeTargetSnapshots(t, db, dom.ID), "应截断到上限")
}
