package networkdomain

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// DomainListItemView enriches a NetworkDomain with derived monitoring-progress
// fields consumed by the list and detail endpoints. AccessStep is computed
// server-side so the frontend never derives it from raw fields.
type DomainListItemView struct {
	models.NetworkDomain
	HasOnlineAgents bool `json:"has_online_agents"` // 决策82-2语义：仅 status=online 的 Agent 数 > 0
	AccessStep      int  `json:"access_step"`       // 1..4 接入进度（第4态数据源由 M09 后续补充）
}

// AccessStepOf derives the access-progress step (1..4) for a domain.
//   1 已登记     —— 有记录即达成
//   2 已纳管     —— IsMonitored
//   3 节点已上线 —— 存在 status=online 的 EdgeAgent
//   4 已出数据   —— 需 M09 生效配置/采集覆盖率信号；MVP 无数据源，回落 3（TODO v0.2+ M09 补齐）
func AccessStepOf(d *models.NetworkDomain, hasOnline bool) int {
	if hasOnline {
		return 3
	}
	if d.IsMonitored {
		return 2
	}
	return 1
}

// onlineAgentDomainIDs returns the set of domain IDs (among the given list that
// have at least one EdgeAgent with status=online, aggregated in a single query
// to avoid N+1 on the list endpoint.
func onlineAgentDomainIDs(db *gorm.DB, domains []models.NetworkDomain) (map[string]bool, error) {
	ids := make([]string, 0, len(domains))
	for i := range domains {
		ids = append(ids, domains[i].ID)
	}
	if len(ids) == 0 {
		return map[string]bool{}, nil
	}
	var rows []struct {
		NetworkDomainID string
		N               int64
	}
	if err := db.Model(&models.EdgeAgent{}).
		Where("network_domain_id IN ?", ids).
		Where("status = ?", models.EdgeAgentStatusOnline).
		Select("network_domain_id, count(*) as n").
		Group("network_domain_id").
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("aggregate online edge agents: %w", err)
	}
	out := make(map[string]bool, len(rows))
	for _, r := range rows {
		out[r.NetworkDomainID] = r.N > 0
	}
	return out, nil
}

// DomainListView converts raw domains into list-view items with derived
// aggregation (online agents + access step).
func DomainListView(db *gorm.DB, list []models.NetworkDomain) ([]DomainListItemView, error) {
	onlineMap, err := onlineAgentDomainIDs(db, list)
	if err != nil {
		return nil, err
	}
	views := make([]DomainListItemView, 0, len(list))
	for i := range list {
		on := onlineMap[list[i].ID]
		views = append(views, DomainListItemView{
			NetworkDomain:   list[i],
			HasOnlineAgents: on,
			AccessStep:      AccessStepOf(&list[i], on),
		})
	}
	return views, nil
}