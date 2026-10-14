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

// 人工滚动重启指令（F-42 seq 简化机制）的服务层 sentinel 错误。
var (
	// ErrRestartNotFound 节点不存在（或已软删）。
	ErrRestartNotFound = errors.New("edge agent not found")
	// ErrRestartNotOnline 节点非 online 状态（offline / unknown / retired），
	// 指令位推进后要等节点上线心跳才会被执行，MVP 直接拒绝并提示先恢复在线。
	ErrRestartNotOnline = errors.New("edge agent is not online")
)

// RequestVMAgentRestart 推进指定采集节点的 vmagent 滚动重启幂等指令位（F-42）：
// vm_agent_restart_seq 原子 +1（gorm.Expr 避免「读-改-写」与心跳全量 Save 竞态），
// 并记录触发人与触发时间（审计留痕）。指令经心跳响应透传，Agent 发现更大 seq 时
// 幂等执行滚动重启（仅重启 vmagent 采集子进程，agent 本体与持久队列不受影响）。
// 返回更新后的节点行。
func RequestVMAgentRestart(db *gorm.DB, id uint, requestedBy string, now time.Time) (*models.EdgeAgent, error) {
	var agent models.EdgeAgent
	if err := db.First(&agent, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRestartNotFound
		}
		return nil, fmt.Errorf("load edge agent %d: %w", id, err)
	}
	if agent.Status != models.EdgeAgentStatusOnline {
		return nil, fmt.Errorf("%w: status=%s (仅在线节点可触发，离线节点上线后心跳会自动同步指令)",
			ErrRestartNotOnline, agent.Status)
	}
	updates := map[string]interface{}{
		// COALESCE 兜底存量行 NULL（AutoMigrate 加列不回填，SQL NULL+1=NULL 会导致
		// 指令位永远推不动，心跳透传 0、Agent 永不执行）。
		"vm_agent_restart_seq": gorm.Expr("COALESCE(vm_agent_restart_seq, 0) + ?", 1),
		"restart_requested_by": requestedBy,
		"restart_requested_at": now,
	}
	if err := db.Model(&models.EdgeAgent{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("bump vm_agent_restart_seq for edge agent %d: %w", id, err)
	}
	if err := db.First(&agent, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("reload edge agent %d: %w", id, err)
	}
	return &agent, nil
}

// RestartAgentHandler 处理 PUT /api/v2/platform/edge-agents/:id/restart（F-42，
// RequireAdmin 门禁由路由组挂载）。成功返回重启后的节点视图。
func RestartAgentHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseUint(c.Param("id"), 10, 64)
		if err != nil {
			response.BadRequest(c, fmt.Errorf("invalid edge agent id: %s", c.Param("id")))
			return
		}
		if _, err := RequestVMAgentRestart(db, uint(id), auth.CurrentUsername(c), time.Now().UTC()); err != nil {
			respondRestartError(c, err)
			return
		}
		// 复用详情视图（含离线降级 / 组件清单），前端拿最新行刷新展示。
		v, err := GetAgent(db, uint(id), time.Now().UTC(), DefaultOfflineThreshold)
		if err != nil {
			respondAgentError(c, err)
			return
		}
		response.OK(c, v)
	}
}

// respondRestartError 将重启指令 sentinel 错误映射为统一响应。
func respondRestartError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrRestartNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, ErrRestartNotOnline):
		response.BadRequest(c, err)
	default:
		response.InternalServerError(c, err)
	}
}
