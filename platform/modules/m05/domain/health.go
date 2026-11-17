package domain

import "context"

// Collection health classification for the homepage "采集健康" panel.
//
// 口径与 v2 `platform/dashboard/collection_health.go` 完全一致（同一份
// `dashboard/summary.collection_health` 契约，前端零改动）：
//
//   - 分母 = 已下发资源数（ready+enabled 采集 Job 选中且仍存在的 resource_id）；
//   - 同一 resource_id 既有 up=1 又有 up=0 样本 → partial_collecting；
//   - 只有 up=1 → collecting；
//   - 其余（只有 up=0 或无样本）→ down。
//
// 查询失败 / 未注入 PromURL 时调用方降级为 nil（响应字段省略），前端按「不可用」
// 呈现，绝不误报 0。

// UpHealthIndex 按 resource_id 归集 `up` 样本的成功 / 失败痕迹。
//
// 字段刻意不导出：判定只能经 ClassifyUpHealth 完成，避免调用方各自实现一套口径。
type UpHealthIndex struct {
	upTrue  map[string]bool
	upFalse map[string]bool
}

// NewUpHealthIndex 由 up 样本构造索引：isOne 为 up=1 的 resource_id 集合，
// isZero 为 up≠1 的集合。
func NewUpHealthIndex(isOne, isZero map[string]bool) *UpHealthIndex {
	return &UpHealthIndex{upTrue: isOne, upFalse: isZero}
}

// UpHealthQuerier 抽象「拉取 up 样本并按 resource_id 归集」的能力，便于单测注入。
type UpHealthQuerier interface {
	// UpHealth 返回按 resource_id 的健康索引；查询失败返回 error（调用方降级）。
	UpHealth(ctx context.Context) (*UpHealthIndex, error)
}

// HealthCounts 是采集健康四态计数的领域表示。
//
// 不变量：Total == Collecting + Partial + Down。
type HealthCounts struct {
	// Total 分母：已下发资源数。
	Total int
	// Collecting 全部 up=1 的资源数。
	Collecting int
	// Partial 同时存在 up=1 与 up=0 样本的资源数。
	Partial int
	// Down 只有 up=0 样本、或无样本的资源数。
	Down int
}

// ClassifyUpHealth 按 up 样本把已下发资源分类（与 v2 classifyCollectionHealth 同口径）。
//
// idx 为 nil（未注入 querier / 查询失败）时返回 nil，由调用方留空降级。
func ClassifyUpHealth(dispatched []string, idx *UpHealthIndex) *HealthCounts {
	if idx == nil {
		return nil
	}
	counts := &HealthCounts{}
	for _, id := range dispatched {
		if id == "" {
			continue
		}
		counts.Total++
		switch {
		case idx.upTrue[id] && idx.upFalse[id]:
			counts.Partial++
		case idx.upTrue[id]:
			counts.Collecting++
		default:
			counts.Down++
		}
	}
	return counts
}
