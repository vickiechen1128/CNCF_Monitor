package seed

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDefaultAlertmanagerConfigMatchesDeployTemplate 守卫「DB seed 内容」与
// 「make run-alertmanager 使用的磁盘模板」不漂移。
func TestDefaultAlertmanagerConfigMatchesDeployTemplate(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "deploy", "alertmanager", "alertmanager.yml"))
	require.NoError(t, err)
	deploy := strings.ReplaceAll(string(raw), "\r\n", "\n")
	// 忽略文件末尾换行差异（Git 检出的模板可能无尾随换行）。
	assert.Equal(t, strings.TrimRight(deploy, "\n"), strings.TrimRight(DefaultAlertmanagerConfigContent, "\n"))
}

func TestEnsureDefaultAlertmanagerConfig_Idempotent(t *testing.T) {
	db := newTestDB(t)

	require.NoError(t, EnsureDefaultAlertmanagerConfig(db))
	var first models.AlertmanagerConfigVersion
	require.NoError(t, db.First(&first).Error)
	assert.Equal(t, models.AlertmanagerConfigStatusApplied, first.Status)
	assert.NotNil(t, first.AppliedAt)
	assert.Equal(t, "system", first.AppliedBy)
	assert.Equal(t, DefaultAlertmanagerConfigContent, first.Content)
	assert.Equal(t, models.AlertmanagerConfigChecksum(DefaultAlertmanagerConfigContent), first.Checksum)

	// 再跑一次不新增。
	require.NoError(t, EnsureDefaultAlertmanagerConfig(db))
	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestEnsureDefaultAlertmanagerConfig_DoesNotOverwriteExisting(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, db.Create(&models.AlertmanagerConfigVersion{
		Content:  "route:\n  receiver: custom\n",
		Checksum: models.AlertmanagerConfigChecksum("route:\n  receiver: custom\n"),
		Status:   models.AlertmanagerConfigStatusApplied,
	}).Error)

	require.NoError(t, EnsureDefaultAlertmanagerConfig(db))
	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.EqualValues(t, 1, count, "已有 applied 版本时不得写入默认配置")
}
