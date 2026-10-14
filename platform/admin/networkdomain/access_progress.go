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
//   4 已出数据   —— 存在已生效的采集任务（enabled 且 draft=ready 且 deployed）
//
// 优先级自高向低：已生效采集任务蕴含「已下发生效」，后三态条件恒成立，
// 故先判 hasEffectiveJob；同理 hasOnline 优先于 IsMonitored（节点上线隐含已纳管）。
func AccessStepOf(d *models.NetworkDomain, hasOnline, hasEffectiveJob bool) int {
	if hasEffectiveJob {
		return 4
	}
	if hasOnline {
		return 3
	}
	if d.IsMonitored {
		return 2
	}
	return 1
}

// effectiveScrapeJobDomainIDs returns the set of domain IDs (among the given list)
// owning at least one scrape job already in force, aggregated in a single query to
// avoid N+1 on the list endpoint.
//
// 「已生效」= enabled 且 draft_status=ready（草稿已定稿）且 change_status=deployed
// （变更单已下发生效），三者缺一即视为尚未产出数据。
func effectiveScrapeJobDomainIDs(db *gorm.DB, domains []models.NetworkDomain) (map[string]bool, error) {
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
	if err := db.Model(&models.ScrapeJob{}).
		Where("network_domain_id IN ?", ids).
		Where("enabled = ?", true).
		Where("draft_status = ?", "ready").
		Where("change_status = ?", models.ChangeStatusDeployed).
		Select("network_domain_id, count(*) as n").
		Group("network_domain_id").
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("aggregate effective scrape jobs: %w", err)
	}
	out := make(map[string]bool, len(rows))
	for _, r := range rows {
		out[r.NetworkDomainID] = r.N > 0
	}
	return out, nil
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
// aggregation (online agents, effective scrape jobs + access step).
func DomainListView(db *gorm.DB, list []models.NetworkDomain) ([]DomainListItemView, error) {
	onlineMap, err := onlineAgentDomainIDs(db, list)
	if err != nil {
		return nil, err
	}
	effectiveMap, err := effectiveScrapeJobDomainIDs(db, list)
	if err != nil {
		return nil, err
	}
	views := make([]DomainListItemView, 0, len(list))
	for i := range list {
		on := onlineMap[list[i].ID]
		views = append(views, DomainListItemView{
			NetworkDomain:   list[i],
			HasOnlineAgents: on,
			AccessStep:      AccessStepOf(&list[i], on, effectiveMap[list[i].ID]),
		})
	}
	return views, nil
}