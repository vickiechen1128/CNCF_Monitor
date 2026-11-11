// Package module defines the v3 module composition contract.
//
// Each v3 module exposes a small Module implementation (name + route
// registration). The application wires modules through a Registry instead of a
// single central route file, which keeps module boundaries explicit and makes
// duplicate registration fail fast.
package module

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
)

// Module is a self-contained v3 business module.
type Module interface {
	// Name returns the stable module name (e.g. "m07"), used for metadata and
	// duplicate detection.
	Name() string
	// RegisterRoutes mounts the module under the supplied platform group
	// (expected prefix: /api/v3/platform).
	RegisterRoutes(platform *gin.RouterGroup) error
}

// Registry holds an ordered set of modules.
type Registry struct {
	modules []Module
	names   map[string]struct{}
}

// NewRegistry creates an empty registry.
func NewRegistry() *Registry {
	return &Registry{names: make(map[string]struct{})}
}

// Register adds a module. Nil modules, empty names and duplicates are rejected.
func (r *Registry) Register(m Module) error {
	if m == nil {
		return fmt.Errorf("module: nil module")
	}
	name := strings.TrimSpace(m.Name())
	if name == "" {
		return fmt.Errorf("module: empty module name")
	}
	if _, exists := r.names[name]; exists {
		return fmt.Errorf("module: duplicate module %q", name)
	}
	r.names[name] = struct{}{}
	r.modules = append(r.modules, m)
	return nil
}

// Mount registers every module's routes in insertion order.
func (r *Registry) Mount(group *gin.RouterGroup) error {
	if group == nil {
		return fmt.Errorf("module: nil router group")
	}
	for _, m := range r.modules {
		if err := m.RegisterRoutes(group); err != nil {
			return fmt.Errorf("module %s: register routes: %w", m.Name(), err)
		}
	}
	return nil
}

// Names returns the registered module names in insertion order.
func (r *Registry) Names() []string {
	out := make([]string, 0, len(r.modules))
	for _, m := range r.modules {
		out = append(out, m.Name())
	}
	return out
}

// Len returns the number of registered modules.
func (r *Registry) Len() int {
	return len(r.modules)
}
