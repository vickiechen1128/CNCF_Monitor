package module

import (
	"errors"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeModule struct {
	name string
	err  error
	hit  *int
}

func (f fakeModule) Name() string { return f.name }

func (f fakeModule) RegisterRoutes(*gin.RouterGroup) error {
	if f.hit != nil {
		(*f.hit)++
	}
	return f.err
}

func TestRegistryRegisterAndMount(t *testing.T) {
	gin.SetMode(gin.TestMode)
	registry := NewRegistry()
	hits := 0
	require.NoError(t, registry.Register(fakeModule{name: "a", hit: &hits}))
	require.NoError(t, registry.Register(fakeModule{name: "b", hit: &hits}))

	require.NoError(t, registry.Mount(gin.New().Group("/api/v3/platform")))
	assert.Equal(t, 2, hits)
	assert.Equal(t, []string{"a", "b"}, registry.Names())
	assert.Equal(t, 2, registry.Len())
}

func TestRegistryRejectsInvalidModules(t *testing.T) {
	registry := NewRegistry()
	assert.Error(t, registry.Register(nil))
	assert.Error(t, registry.Register(fakeModule{name: "  "}))
	require.NoError(t, registry.Register(fakeModule{name: "a"}))
	assert.Error(t, registry.Register(fakeModule{name: "a"}))
}

func TestRegistryMountError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	registry := NewRegistry()
	require.NoError(t, registry.Register(fakeModule{name: "a", err: errors.New("boom")}))

	err := registry.Mount(gin.New().Group("/api/v3/platform"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "module a")
	assert.Contains(t, err.Error(), "boom")
}

func TestRegistryNilGroup(t *testing.T) {
	assert.Error(t, NewRegistry().Mount(nil))
}
