package inhibition

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/alertmanager/route"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

var saveAlertmanagerConfig = route.SaveAlertmanagerConfig

// Repository loads the current product view and delegates the shared save pipeline.
type Repository struct {
	db *gorm.DB
}

// NewRepository constructs an inhibition repository.
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// List reads inhibition rules and their optimistic-lock base.
func (r *Repository) List() (*View, error) {
	product, err := route.EffectiveAlertmanagerYAML(r.db)
	if err != nil {
		return nil, err
	}
	baseYAML, _ := product["yaml"].(string)
	rules, err := generator.ParseInhibitRules(baseYAML)
	if err != nil {
		return nil, err
	}
	view := &View{Items: rules, EffectiveChecksum: models.AlertmanagerConfigChecksum(baseYAML)}
	routeView, err := route.ListRoutes(r.db)
	if err != nil {
		return nil, err
	}
	view.Pending = routeView["pending"]
	return view, nil
}

// Save preserves the current route tree and submits modified inhibition rules.
func (r *Repository) Save(baseChecksum string, rules []generator.InhibitionRule, uploadedBy string) (*route.SaveRoutesResult, error) {
	product, err := route.EffectiveAlertmanagerYAML(r.db)
	if err != nil {
		return nil, err
	}
	baseYAML, _ := product["yaml"].(string)
	nodes, err := route.ParseRouteTree(baseYAML)
	if err != nil {
		return nil, fmt.Errorf("保留当前路由失败: %w", err)
	}
	return saveAlertmanagerConfig(r.db, route.ToEditNodes(nodes), rules, baseChecksum, uploadedBy)
}
