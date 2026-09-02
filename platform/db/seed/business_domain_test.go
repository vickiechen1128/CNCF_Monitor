package seed

import (
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// bizSeedTestDBCounter 为每个业务 seed 测试生成唯一的内存 DB 名，避免共享库串扰。
var bizSeedTestDBCounter int64

func openBizSeedTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&bizSeedTestDBCounter, 1)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:biz_seed_%d?mode=memory&cache=shared", n)), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.BusinessDomain{}))
	return db
}

func writeBizSeedYAML(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "business_domains.yaml")
	require.NoError(t, os.WriteFile(path, []byte(content), 0o644))
	return path
}

func countBizCodes(t *testing.T, db *gorm.DB) []string {
	t.Helper()
	var rows []models.BusinessDomain
	require.NoError(t, db.Order("id ASC").Find(&rows).Error)
	codes := make([]string, 0, len(rows))
	for _, r := range rows {
		codes = append(codes, r.Code)
	}
	return codes
}

// TestBusinessDomainsSeedsYAMLPlusInfraFallback 覆盖正常路径：DB 空时从 yaml 导入，
// 并强制预置不足的 infra 兜底条目（决策 48）。
func TestBusinessDomainsSeedsYAMLPlusInfraFallback(t *testing.T) {
	db := openBizSeedTestDB(t)
	yaml := `- code: authorized-ops
  name: 授权运营
  description: 授权运营业务域
  enabled: true
- code: data-innovation-lab
  name: 数据创新实验室
  description: 数据创新实验室业务域
  enabled: true
`
	require.NoError(t, BusinessDomains(db, writeBizSeedYAML(t, yaml)))

	codes := countBizCodes(t, db)
	assert.ElementsMatch(t, []string{models.InfraBizCode, "authorized-ops", "data-innovation-lab"}, codes)

	var infra models.BusinessDomain
	require.NoError(t, db.Where("code = ?", models.InfraBizCode).First(&infra).Error)
	assert.True(t, infra.Enabled, "infra 兜底条目应启用")
	assert.Equal(t, "公共基础设施", infra.Name)
}

// TestBusinessDomainsYAMLAlreadyHasInfra 覆盖 yaml 已含 infra 时不重复预置。
func TestBusinessDomainsYAMLAlreadyHasInfra(t *testing.T) {
	db := openBizSeedTestDB(t)
	yaml := `- code: infra
  name: 公共基础设施
  enabled: true
- code: payment
  name: 支付业务
  enabled: true
`
	require.NoError(t, BusinessDomains(db, writeBizSeedYAML(t, yaml)))

	codes := countBizCodes(t, db)
	assert.ElementsMatch(t, []string{models.InfraBizCode, "payment"}, codes, "infra 已在 yaml 中不应重复")
}

// TestBusinessDomainsSkipsWhenNonEmpty 覆盖 DB 非空则不再 seed（决策 48：DB 为唯一
// 权威，绝不覆盖）。
func TestBusinessDomainsSkipsWhenNonEmpty(t *testing.T) {
	db := openBizSeedTestDB(t)
	// 先 seed 一次。
	yaml := `- code: payment
  name: 支付业务
  enabled: true
`
	require.NoError(t, BusinessDomains(db, writeBizSeedYAML(t, yaml)))

	// 手工新增一条后再次调用：DB 非空，不得覆盖既有数据。
	require.NoError(t, db.Create(&models.BusinessDomain{Code: "custom", Name: "自定义", Enabled: true}).Error)
	require.NoError(t, BusinessDomains(db, writeBizSeedYAML(t, yaml)))

	codes := countBizCodes(t, db)
	assert.ElementsMatch(t, []string{models.InfraBizCode, "payment", "custom"}, codes, "DB 非空时不覆盖，custom 保留")
}

// TestBusinessDomainsIdempotent 覆盖重复调用幂等：首次 seed 后表非空，二次调用直接返回。
func TestBusinessDomainsIdempotent(t *testing.T) {
	db := openBizSeedTestDB(t)
	yaml := `- code: payment
  name: 支付业务
  enabled: true
`
	require.NoError(t, BusinessDomains(db, writeBizSeedYAML(t, yaml)))
	require.NoError(t, BusinessDomains(db, writeBizSeedYAML(t, yaml)))

	assert.ElementsMatch(t, []string{models.InfraBizCode, "payment"}, countBizCodes(t, db), "重复调用不产生重复条目")
}

// TestBusinessDomainsMissingFileFallsBackToInfra 覆盖文件缺失降级：仍强制预置 infra，
// 不阻断（决策 48 保证 infra 恒存在）。
func TestBusinessDomainsMissingFileFallsBackToInfra(t *testing.T) {
	db := openBizSeedTestDB(t)
	require.NoError(t, BusinessDomains(db, filepath.Join(t.TempDir(), "does-not-exist.yaml")))

	codes := countBizCodes(t, db)
	assert.ElementsMatch(t, []string{models.InfraBizCode}, codes, "文件缺失时仅落 infra 兜底条目")
}

func TestBusinessDomainsNilDBReturnsError(t *testing.T) {
	assert.Error(t, BusinessDomains(nil, "x.yaml"))
}