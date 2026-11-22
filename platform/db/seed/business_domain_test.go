package seed

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// openBizSeedTestDB 在每个测试自己的 PostgreSQL schema 里建表，避免相互串扰。
func openBizSeedTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := newTestDB(t)
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

// TestBusinessDomainsDoesNotSeedInfra 是 M07 SRS v2.0 的核心回归：
// 全新数据库 + 仓库自带模板启动后，业务字典必须为空，不得出现 infra
// 或任何其他预置条目。
func TestBusinessDomainsDoesNotSeedInfra(t *testing.T) {
	db := openBizSeedTestDB(t)
	require.NoError(t, BusinessDomains(db, writeBizSeedYAML(t, "# no entries\n")))

	assert.Empty(t, countBizCodes(t, db), "系统不应预置任何业务字典")
}

// TestBusinessDomainsImportsExplicitYAML 覆盖可选的空库一次性导入：
// 运维显式写入模板的条目会被导入，但不会额外补 infra。
func TestBusinessDomainsImportsExplicitYAML(t *testing.T) {
	db := openBizSeedTestDB(t)
	yaml := `- code: payment
  name: 支付业务
  description: 支付相关资源
  enabled: true
`
	require.NoError(t, BusinessDomains(db, writeBizSeedYAML(t, yaml)))

	assert.ElementsMatch(t, []string{"payment"}, countBizCodes(t, db))
}

// TestBusinessDomainsSkipsWhenNonEmpty 覆盖 DB 非空则不再 seed（DB 为唯一权威）。
func TestBusinessDomainsSkipsWhenNonEmpty(t *testing.T) {
	db := openBizSeedTestDB(t)
	yaml := `- code: payment
  name: 支付业务
  enabled: true
`
	require.NoError(t, BusinessDomains(db, writeBizSeedYAML(t, yaml)))

	require.NoError(t, db.Create(&models.BusinessDomain{Code: "custom", Name: "自定义", Enabled: true}).Error)
	require.NoError(t, BusinessDomains(db, writeBizSeedYAML(t, yaml)))

	assert.ElementsMatch(t, []string{"payment", "custom"}, countBizCodes(t, db), "DB 非空时不覆盖，custom 保留")
}

// TestBusinessDomainsIdempotent 覆盖重复调用幂等。
func TestBusinessDomainsIdempotent(t *testing.T) {
	db := openBizSeedTestDB(t)
	yaml := `- code: payment
  name: 支付业务
  enabled: true
`
	require.NoError(t, BusinessDomains(db, writeBizSeedYAML(t, yaml)))
	require.NoError(t, BusinessDomains(db, writeBizSeedYAML(t, yaml)))

	assert.ElementsMatch(t, []string{"payment"}, countBizCodes(t, db), "重复调用不产生重复条目")
}

// TestBusinessDomainsMissingFileIsNoop 覆盖文件缺失降级：不导入、不阻断、不补 infra。
func TestBusinessDomainsMissingFileIsNoop(t *testing.T) {
	db := openBizSeedTestDB(t)
	require.NoError(t, BusinessDomains(db, filepath.Join(t.TempDir(), "does-not-exist.yaml")))

	assert.Empty(t, countBizCodes(t, db))
}

func TestBusinessDomainsNilDBReturnsError(t *testing.T) {
	assert.Error(t, BusinessDomains(nil, "x.yaml"))
}
