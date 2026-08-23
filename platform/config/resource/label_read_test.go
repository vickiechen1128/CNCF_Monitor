package resource

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// labelReadTestDBCounter 为每个测试生成唯一的内存 DB 名，避免同包内测试共享同一库。
var labelReadTestDBCounter int64

// openLabelReadTestDB 打开逐测试的内存 SQLite，并迁移标签读取涉及的表：
// 五类资源 + LabelTemplate（system 实时计算） + ResourceLabel（user 落库）。
func openLabelReadTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&labelReadTestDBCounter, 1)
	dsn := fmt.Sprintf("file:resource_label_read_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.LabelTemplate{},
		&models.ResourceLabel{},
	))
	return db
}

// mountGetResourceLabels 挂载标签读取 handler 供测试（路由收口见 T07-18，此处仅测试挂载）。
func mountGetResourceLabels(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v2/platform/resources/:resource_id/labels", GetResourceLabels(db))
	return r
}

// labelReadItem 镜像标签读取接口的 item 契约：{id, key, value, source, source_map?}。
type labelReadItem struct {
	ID        uint   `json:"id"`
	Key       string `json:"key"`
	Value     string `json:"value"`
	Source    string `json:"source"`
	SourceMap string `json:"source_map"`
}

// labelReadResponse 镜像标签读取接口的统一响应信封，data 为 {items, total}。
type labelReadResponse struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
	Data      struct {
		Items []labelReadItem `json:"items"`
		Total int             `json:"total"`
	} `json:"data"`
}

// doGetResourceLabels 请求标签读取接口并解码统一响应。
func doGetResourceLabels(t *testing.T, r *gin.Engine, resourceID string) (*httptest.ResponseRecorder, labelReadResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources/"+resourceID+"/labels", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out labelReadResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w, out
}

// seedLabelReadHost 落一条 legacy 列齐全的主机 fixture（AppCode/EnvFlag/SubAppCode/
// InstanceName/Image/PrivateIP 经 GetResourceField legacy 映射读取）。
func seedLabelReadHost(t *testing.T, db *gorm.DB, id string) *models.Host {
	t.Helper()
	h := &models.Host{
		ResourceID:       id,
		ServerID:         id,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  "default",
		BizCode:          "payment",
		SourceType:       models.SourceTypeManual,
		AppCode:          "payment-api",
		SubAppCode:       "cluster-a",
		EnvFlag:          "prod",
		InstanceName:     "web-01.example.com",
		Status:           "online",
		Image:            "linux",
		PrivateIP:        "10.0.0.1",
		Region:           "cn",
		ZoneEnv:          "prod",
		InstanceSpec:     "2c4g",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
	}
	require.NoError(t, db.Create(h).Error)
	return h
}

// seedLabelReadApplication 落一条应用服务 fixture。
func seedLabelReadApplication(t *testing.T, db *gorm.DB, id string) *models.Application {
	t.Helper()
	a := &models.Application{
		ResourceID:       id,
		ResourceType:     models.ResourceTypeApplication,
		ResourceCategory: models.ResourceCategoryApplication,
		NetworkDomainID:  "default",
		BizCode:          "payment",
		SourceType:       models.SourceTypeManual,
		AppName:          "order-svc",
		Env:              "prod",
		Cluster:          "pay-cluster",
		Status:           "online",
		ServiceName:      "order-svc",
		HealthCheckURL:   "http://10.0.0.5:8080/healthz",
		Protocol:         "http",
		Endpoint:         "10.0.0.5:8080",
	}
	require.NoError(t, db.Create(a).Error)
	return a
}

// hostLabelReadDefaultTemplate 构造主机默认标签模板（覆盖 composite→instance 与
// app/env/cluster/biz/hostname/os_type 等 resource_field 映射，§5.13）。
func hostLabelReadDefaultTemplate() *models.LabelTemplate {
	return &models.LabelTemplate{
		Name:             "主机默认模板",
		ResourceCategory: models.ResourceCategoryHost,
		IsDefault:        true,
		Mappings: []models.LabelMapping{
			{SourceField: "instance_ip:port", SourceType: models.LabelSourceTypeComposite, TargetLabel: "instance", Enabled: true},
			{SourceField: "app_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true},
			{SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env", Enabled: true},
			{SourceField: "cluster", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "cluster", Enabled: true},
			{SourceField: "biz_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "biz", Enabled: true},
			{SourceField: "hostname", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "hostname", Enabled: true},
			{SourceField: "os_type", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "os_type", Enabled: true},
		},
	}
}

// seedLabelReadTemplate 落一条标签模板 fixture。
func seedLabelReadTemplate(t *testing.T, db *gorm.DB, tmpl *models.LabelTemplate) {
	t.Helper()
	require.NoError(t, db.Create(tmpl).Error)
}

// seedLabelReadUserLabel 落一条 user 来源标签 fixture。
func seedLabelReadUserLabel(t *testing.T, db *gorm.DB, resourceID, key, value string) *models.ResourceLabel {
	t.Helper()
	l := &models.ResourceLabel{
		ResourceID: resourceID,
		Key:        key,
		Value:      value,
		Source:     models.LabelSourceUser,
	}
	require.NoError(t, db.Create(l).Error)
	return l
}

// seedLabelReadCMDBLabel 落一条 cmdb 来源标签 fixture（v0.4+ 预留占位）。
func seedLabelReadCMDBLabel(t *testing.T, db *gorm.DB, resourceID, key, value string) *models.ResourceLabel {
	t.Helper()
	l := &models.ResourceLabel{
		ResourceID: resourceID,
		Key:        key,
		Value:      value,
		Source:     models.LabelSourceCMDB,
	}
	require.NoError(t, db.Create(l).Error)
	return l
}

// itemIndex 返回 items 中首个 key 匹配项的索引；未命中返回 -1。
func itemIndex(items []labelReadItem, key string) int {
	for i, it := range items {
		if it.Key == key {
			return i
		}
	}
	return -1
}

// TestGetResourceLabelsSystemComputed 覆盖 system 标签实时计算合并：host + 默认模板
// 返回 system 来源标签（app/env/cluster/biz/hostname/os_type + composite→instance），
// 携带 source_map、不落库 id 恒为 0。
func TestGetResourceLabelsSystemComputed(t *testing.T) {
	db := openLabelReadTestDB(t)
	r := mountGetResourceLabels(t, db)
	seedLabelReadHost(t, db, "host-1")
	seedLabelReadTemplate(t, db, hostLabelReadDefaultTemplate())

	w, out := doGetResourceLabels(t, r, "host-1")
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "success", out.Status)
	require.Equal(t, 7, out.Data.Total)
	require.Len(t, out.Data.Items, 7)

	app := out.Data.Items[itemIndex(out.Data.Items, "app")]
	assert.Equal(t, "payment-api", app.Value)
	assert.Equal(t, "system", app.Source)
	assert.Equal(t, "app_name→app", app.SourceMap)
	assert.Zero(t, app.ID, "system 标签实时计算不落库，id 恒为 0（§5.3）")

	biz := out.Data.Items[itemIndex(out.Data.Items, "biz")]
	assert.Equal(t, "payment", biz.Value)
	assert.Equal(t, "system", biz.Source)

	inst := out.Data.Items[itemIndex(out.Data.Items, "instance")]
	assert.Equal(t, "", inst.Value, "composite→instance 本阶段不生成拼接值（§5.12 C）")
	assert.Equal(t, "instance_ip:port→instance（内置默认）", inst.SourceMap)
}

// TestGetResourceLabelsUserStored 覆盖 user 标签从 ResourceLabel 表读取：source=user、
// 有真实库内 id、无 source_map。
func TestGetResourceLabelsUserStored(t *testing.T) {
	db := openLabelReadTestDB(t)
	r := mountGetResourceLabels(t, db)
	seedLabelReadApplication(t, db, "app-1")
	l := seedLabelReadUserLabel(t, db, "app-1", "team", "pay")

	w, out := doGetResourceLabels(t, r, "app-1")
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "success", out.Status)
	require.Equal(t, 1, out.Data.Total)
	require.Len(t, out.Data.Items, 1)

	it := out.Data.Items[0]
	assert.Equal(t, l.ID, it.ID, "user 标签带真实库内 id，供编辑/删除定位")
	assert.Equal(t, "team", it.Key)
	assert.Equal(t, "pay", it.Value)
	assert.Equal(t, "user", it.Source)
	assert.Empty(t, it.SourceMap, "user 标签无 source_map")
}

// TestGetResourceLabelsMergeOrder 覆盖合并排序：按来源优先级 system 在前、user 在后、
// cmdb 为 v0.4+ 预留占位（最后）（§6.6.2 / §8.2）。
func TestGetResourceLabelsMergeOrder(t *testing.T) {
	db := openLabelReadTestDB(t)
	r := mountGetResourceLabels(t, db)
	seedLabelReadHost(t, db, "host-1")
	seedLabelReadTemplate(t, db, hostLabelReadDefaultTemplate())
	seedLabelReadUserLabel(t, db, "host-1", "team", "pay")
	seedLabelReadCMDBLabel(t, db, "host-1", "cmdb_owner", "alice")

	w, out := doGetResourceLabels(t, r, "host-1")
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "success", out.Status)
	require.Equal(t, 9, out.Data.Total)

	// 所有 system 项必须排在所有 user / cmdb 项之前。
	lastSystem := -1
	firstStored := -1
	for i, it := range out.Data.Items {
		if it.Source == "system" {
			lastSystem = i
		} else if firstStored == -1 {
			firstStored = i
		}
	}
	assert.True(t, lastSystem < firstStored, "system 应在 user/cmdb 之前展示")

	// cmdb 占位排在 user 之后（v0.4+ 预留，§6.6.2）。
	assert.True(t, itemIndex(out.Data.Items, "team") < itemIndex(out.Data.Items, "cmdb_owner"),
		"cmdb 来源应排最后（v0.4+ 预留占位）")
	assert.Equal(t, "user", out.Data.Items[itemIndex(out.Data.Items, "team")].Source)
	assert.Equal(t, "cmdb", out.Data.Items[itemIndex(out.Data.Items, "cmdb_owner")].Source)
}

// TestGetResourceLabelsSameKeyUserWins 覆盖同 key 冲突：system 与 user 同 key 时不重复
// 展示，以 user 为准（§5.3 冲突优先级，user 优先于 system 展示）。
func TestGetResourceLabelsSameKeyUserWins(t *testing.T) {
	db := openLabelReadTestDB(t)
	r := mountGetResourceLabels(t, db)
	seedLabelReadHost(t, db, "host-1")
	seedLabelReadTemplate(t, db, hostLabelReadDefaultTemplate())
	// 用户为 key=app 添加自定义值，覆盖默认模板生成的 system app（payment-api）。
	seedLabelReadUserLabel(t, db, "host-1", "app", "custom-app")

	w, out := doGetResourceLabels(t, r, "host-1")
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "success", out.Status)
	// 默认模板 7 条中 app 被 user 覆盖，不重复展示 → total = 7。
	require.Equal(t, 7, out.Data.Total)

	app := out.Data.Items[itemIndex(out.Data.Items, "app")]
	assert.Equal(t, "custom-app", app.Value, "同 key 以 user 为准（§5.3）")
	assert.Equal(t, "user", app.Source)
	assert.NotZero(t, app.ID)
	assert.Empty(t, app.SourceMap)

	// 其余 system 标签照常展示。
	assert.Equal(t, "payment", out.Data.Items[itemIndex(out.Data.Items, "biz")].Value)
}

// TestGetResourceLabelsNotFound 覆盖资源不存在返回 not_found。
func TestGetResourceLabelsNotFound(t *testing.T) {
	db := openLabelReadTestDB(t)
	r := mountGetResourceLabels(t, db)
	seedLabelReadTemplate(t, db, hostLabelReadDefaultTemplate())

	w, out := doGetResourceLabels(t, r, "no-such-resource")
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "not_found", out.ErrorType)
	assert.Contains(t, out.Error, "no-such-resource")
}

// TestGetResourceLabelsNoDefaultTemplate 覆盖无默认模板的防御路径：system 为空，
// 接口不报错，仍返回库内 user 标签（「适用模板」空态在 T07-13 查询层呈现）。
func TestGetResourceLabelsNoDefaultTemplate(t *testing.T) {
	db := openLabelReadTestDB(t)
	r := mountGetResourceLabels(t, db)
	seedLabelReadApplication(t, db, "app-1")
	seedLabelReadUserLabel(t, db, "app-1", "team", "pay")

	w, out := doGetResourceLabels(t, r, "app-1")
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "success", out.Status)
	require.Equal(t, 1, out.Data.Total)
	assert.Equal(t, "team", out.Data.Items[0].Key)
	assert.Equal(t, "user", out.Data.Items[0].Source)
}
