package draft

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
)

func TestBuildChangeItemsIncludesBlackboxModuleOnlyChange(t *testing.T) {
	base := &models.ConfigVersion{BlackboxYml: "modules:\n  http_2xx:\n    prober: http\n    timeout: 5s\n"}
	artifacts := &generator.ConfigArtifacts{BlackboxYML: "modules:\n  http_2xx:\n    prober: http\n    timeout: 10s\n"}
	items := buildChangeItems(nil, nil, artifacts, base)
	assert.Len(t, items, 1)
	assert.Equal(t, string(models.ChangeItemTypeUpdate), items[0].Type)
	assert.Equal(t, string(models.ChangeItemTargetProbeTarget), items[0].Target)
	assert.Contains(t, items[0].Description, "拨测模块配置")
}
