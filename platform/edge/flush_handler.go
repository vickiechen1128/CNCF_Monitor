package edge

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
)

// 清空回传积压破坏性指令（F-43 seq 简化机制）的服务层 sentinel 错误。
var (
	// ErrFlushNotFound 节点不存在（或已软删）。
	ErrFlushNotFound = errors.New("edge agent not found")
	// ErrFlushNotOnline 节点非 online 状态（offline / unknown / retired）。
	// 与重启指令不同，这是破坏性操作：离线节点上执行等于对一份失去可信实时状态的
	// 数据盲删，拒绝并提示先恢复在线再操作。
	ErrFlushNotOnline = errors.New("edge agent is not online")
)

// RequestFlushBacklog 推进指定采集节点的「清空回传积压」幂等指令位（F-43）：
// flush_backlog_seq 原子 +1（gorm.Expr 避免与心跳全量 Save 竞态），并记录触发人与
// 触发时间（审计留痕）。指令经心跳响应透传，Agent 发现更大 seq 时执行破坏性清空：
// 先停 vmagent 再删其持久队列目录（EDGE_WAL_DIR 下 vmagent 持久队列数据），有意
// 丢弃积压数据换取回传通道实时性恢复——适用于「积压排空时间远超时效容忍」的止血
// 场景（2026-10-12 实测：1.4GB 积压按 174KB/s 通道需 9h+，期间新数据一直阻塞在队尾）。
// 返回更新后的节点行。
func RequestFlushBacklog(db *gorm.DB, id uint, requestedBy string, now time.Time) (*models.EdgeAgent, error) {
	var agent models.EdgeAgent
	if err := db.First(&agent, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrFlushNotFound
		}
		return nil, fmt.Errorf("load edge agent %d: %w", id, err)
	}
	if agent.Status != models.EdgeAgentStatusOnline {
		return nil, fmt.Errorf("%w: status=%s (破坏性操作仅限在线节点；离线节点积压状态已失去可信实时参照，先恢复在线再操作)",
			ErrFlushNotOnline, agent.Status)
	}
	updates := map[string]interface{}{
		// COALESCE 兜底存量行 NULL（AutoMigrate 加列不回填，SQL NULL+1=NULL 会导致
		// 指令位永远推不动，心跳透传 0、Agent 永不执行）。
		"flush_backlog_seq":  gorm.Expr("COALESCE(flush_backlog_seq, 0) + ?", 1),
		"flush_requested_by": requestedBy,
		"flush_requested_at": now,
	}
	if err := db.Model(&models.EdgeAgent{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("bump flush_backlog_seq for edge agent %d: %w", id, err)
	}
	if err := db.First(&agent, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("reload edge agent %d: %w", id, err)
	}
	return &agent, nil
}

// FlushBacklogHandler 处理 PUT /api/v2/platform/edge-agents/:id/flush-backlog
// （F-43，RequireAdmin 门禁由路由组挂载）。成功返回更新后的节点视图。
func FlushBacklogHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseUint(c.Param("id"), 10, 64)
		if err != nil {
			response.BadRequest(c, fmt.Errorf("invalid edge agent id: %s", c.Param("id")))
			return
		}
		if _, err := RequestFlushBacklog(db, uint(id), auth.CurrentUsername(c), time.Now().UTC()); err != nil {
			respondFlushError(c, err)
			return
		}
		// 复用详情视图（含离线降级 / 组件清单），前端拿最新行刷新展示与留痕。
		v, err := GetAgent(db, uint(id), time.Now().UTC(), DefaultOfflineThreshold)
		if err != nil {
			respondAgentError(c, err)
			return
		}
		response.OK(c, v)
	}
}

// respondFlushError 将清积压指令 sentinel 错误映射为统一响应。
func respondFlushError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrFlushNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, ErrFlushNotOnline):
		response.BadRequest(c, err)
	default:
		response.InternalServerError(c, err)
	}
}
