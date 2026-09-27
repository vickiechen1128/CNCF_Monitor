package seed

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runDomainChannelBackfill 把 channel 与 domain_type 不一致的历史网域一次性对齐
// （F-28 方案 A）。通道由域类型唯一派生（models.ChannelForDomainType）：管理域↔local、
// 边缘域↔agent_pull。登记接口早期版本无条件写入 local，使未纳管的边缘域在列表 /
// 详情 / 纳管抽屉被误判为 local 通道（连带不弹 Token 复制弹窗）。
//
// 幂等：仅命中不一致行，重复执行不改变已对齐数据，也不影响每轮新登记的正确值。
func runDomainChannelBackfill(db *gorm.DB) error {
	for _, dt := range []models.DomainType{models.DomainTypeManagement, models.DomainTypeEdge} {
		want := models.ChannelForDomainType(dt)
		if err := db.Model(&models.NetworkDomain{}).
			Where("domain_type = ? AND channel <> ?", dt, want).
			Update("channel", want).Error; err != nil {
			return fmt.Errorf("backfill channel for %s domains: %w", dt, err)
		}
	}
	return nil
}