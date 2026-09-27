package resource

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// CloudDict 是云字典只读 API 的传输视图。
//
// 注意（前端红线的④对齐）：cloud_type / carrier 仅为描述性元数据
// （如"公有云/私有云"、"运营商"），用于展示与筛选辅助，绝非独立的分类轴。
// 资源的云/区/网域归属一律由 network_domain.cloud_code / zone_type 派生
// （决策 103 scheme-B），前端不得将其渲染为独立列或独立筛选维度。
type CloudDict struct {
	CloudCode string              `json:"cloud_code"`
	CloudName string              `json:"cloud_name"`
	CloudType models.CloudType    `json:"cloud_type"`
	Carrier   models.CloudCarrier `json:"carrier"`
	Enabled   bool                `json:"enabled"`
}

// CloudDictStore 提供云字典只读访问能力。
type CloudDictStore struct {
	db *gorm.DB
}

func NewCloudDictStore(db *gorm.DB) *CloudDictStore {
	return &CloudDictStore{db: db}
}

func toCloudDict(row models.CloudDict) CloudDict {
	return CloudDict{
		CloudCode: row.CloudCode,
		CloudName: row.CloudName,
		CloudType: row.CloudType,
		Carrier:   row.Carrier,
		Enabled:   row.Enabled,
	}
}

// List 返回全量云字典条目（含停用项）。
func (s *CloudDictStore) List() ([]CloudDict, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("云字典未初始化：store 为空")
	}
	var rows []models.CloudDict
	if err := s.db.Order("id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询云字典：%w", err)
	}
	out := make([]CloudDict, 0, len(rows))
	for _, row := range rows {
		out = append(out, toCloudDict(row))
	}
	return out, nil
}

// EnabledList 返回全部启用云字典条目。
func (s *CloudDictStore) EnabledList() ([]CloudDict, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("云字典未初始化：store 为空")
	}
	var rows []models.CloudDict
	if err := s.db.Where("enabled = ?", true).Order("id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询启用云字典：%w", err)
	}
	out := make([]CloudDict, 0, len(rows))
	for _, row := range rows {
		out = append(out, toCloudDict(row))
	}
	return out, nil
}

// GetEnabledMap 返回启用条目映射 cloud_code -> CloudDict，供资源写入与导入校验。
func (s *CloudDictStore) GetEnabledMap() (map[string]CloudDict, error) {
	list, err := s.EnabledList()
	if err != nil {
		return nil, err
	}
	out := make(map[string]CloudDict, len(list))
	for _, item := range list {
		out[item.CloudCode] = item
	}
	return out, nil
}

// ListCloudDicts 处理 GET /api/v2/platform/cloud-dict。
func ListCloudDicts(store *CloudDictStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		list, err := store.List()
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, gin.H{"list": list, "total": len(list)})
	}
}
