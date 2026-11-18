package deployment

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// RollbackPreview 返回「回滚到目标 ConfigVersion」前的源数据操作差异预览（决策 63 P0）。
// 用于前端回滚确认弹窗展示「目标版本 vs 当前生效版本」之间的源数据操作差异清单，
// 并固定提示「回滚不恢复 M01/M08 中的启停状态」。
//
// 当前生效版本定义为该网域最近一次 status=success 或 rolled_back 的下发记录所对应的
// ConfigVersion；无成功下发时 current_version 为空（常见于首次回滚或网域尚未成功下发）。
func RollbackPreview(db *gorm.DB, versionID string) (*models.RollbackPreview, error) {
	target, err := loadVersion(db, versionID)
	if err != nil {
		return nil, err
	}

	currentVersion, err := currentEffectiveVersion(db, target.NetworkDomainID)
	if err != nil {
		return nil, err
	}

	preview := &models.RollbackPreview{
		TargetVersion: models.VersionRef{
			ID:       fmt.Sprint(target.ID),
			ChangeNo: target.ChangeNo,
		},
		Warning: "回滚不恢复 M01/M08 中的启停状态",
	}

	if currentVersion != nil {
		preview.CurrentVersion = &models.VersionRef{
			ID:       fmt.Sprint(currentVersion.ID),
			ChangeNo: currentVersion.ChangeNo,
		}
	}

	targetItems, err := changeItemsOfVersion(db, target)
	if err != nil {
		return nil, err
	}
	currentItems, err := changeItemsOfVersion(db, currentVersion)
	if err != nil {
		return nil, err
	}

	preview.DiffItems = deriveRollbackDiff(targetItems, currentItems)
	return preview, nil
}

// currentEffectiveVersion 返回网域当前生效的 ConfigVersion（最近 success/rolled_back 下发记录）。
func currentEffectiveVersion(db *gorm.DB, domainID string) (*models.ConfigVersion, error) {
	var dep models.ConfigDeployment
	err := db.Where("network_domain_id = ? AND status IN ?", domainID,
		[]models.DeploymentStatus{models.DeploymentStatusSuccess, models.DeploymentStatusRolledBack}).
		Order("created_at DESC, id DESC").
		First(&dep).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load current effective deployment: %w", err)
	}
	return loadVersion(db, dep.ConfigVersionID)
}

// changeItemsOfVersion 读取版本对应变更单的 change_items；版本为空或变更单不存在返回空。
func changeItemsOfVersion(db *gorm.DB, v *models.ConfigVersion) ([]models.ConfigChangeItem, error) {
	if v == nil || v.ChangeNo == "" {
		return nil, nil
	}
	var d models.ConfigDraft
	if err := db.Where("change_no = ?", v.ChangeNo).First(&d).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("load draft for change_no %s: %w", v.ChangeNo, err)
	}
	if d.ChangeItems == "" {
		return nil, nil
	}
	var items []models.ConfigChangeItem
	if err := json.Unmarshal([]byte(d.ChangeItems), &items); err != nil {
		return nil, fmt.Errorf("parse change_items for %s: %w", v.ChangeNo, err)
	}
	return items, nil
}

// deriveRollbackDiff 合并目标版本与当前生效版本的 change_items，按 side 标记差异。
// 两条清单中的同型同对象项按 description 去重合并；无法精确匹配时保留两侧原样展示。
func deriveRollbackDiff(targetItems, currentItems []models.ConfigChangeItem) []models.RollbackDiffItem {
	// key = target+type+description（变更对象 + 操作类型 + 说明）作为稳定匹配键。
	type key struct{ target, typ, description string }

	targetMap := map[key]models.ConfigChangeItem{}
	for _, it := range targetItems {
		targetMap[key{it.Target, it.Type, it.Description}] = it
	}
	currentMap := map[key]models.ConfigChangeItem{}
	for _, it := range currentItems {
		currentMap[key{it.Target, it.Type, it.Description}] = it
	}

	seen := map[key]bool{}
	out := make([]models.RollbackDiffItem, 0, len(targetItems)+len(currentItems))

	// 先输出目标版本侧。
	for _, it := range targetItems {
		k := key{it.Target, it.Type, it.Description}
		if seen[k] {
			continue
		}
		seen[k] = true
		_, inCurrent := currentMap[k]
		side := "both"
		if !inCurrent {
			side = "target"
		}
		out = append(out, models.RollbackDiffItem{
			Side:          side,
			Type:          it.Type,
			Target:        it.Target,
			Description:   it.Description,
			AffectedFiles: it.AffectedFiles,
			Risk:          it.Risk,
		})
	}

	// 再输出仅存在于当前生效版本的项。
	for _, it := range currentItems {
		k := key{it.Target, it.Type, it.Description}
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, models.RollbackDiffItem{
			Side:          "current",
			Type:          it.Type,
			Target:        it.Target,
			Description:   it.Description,
			AffectedFiles: it.AffectedFiles,
			Risk:          it.Risk,
		})
	}
	return out
}
