package m01

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestNewModuleRequiresDatabase(t *testing.T) {
	_, err := NewModule(nil)
	require.Error(t, err)
}

func TestModuleWiring(t *testing.T) {
	module, err := NewModule(new(gorm.DB))
	require.NoError(t, err)
	assert.Equal(t, "m01", module.Name())

	repos := module.Repositories()
	assert.NotNil(t, repos.Exporters)
	assert.NotNil(t, repos.Mappings)
	assert.NotNil(t, repos.Jobs)
	assert.NotNil(t, repos.Rules)
	assert.NotNil(t, repos.Metrics)
	assert.NotNil(t, repos.BusinessMetrics)
	assert.NotNil(t, repos.Installations)
	assert.NotNil(t, repos.ProbeModules)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	require.NoError(t, module.RegisterRoutes(router.Group("/api/v3/platform")))
}
