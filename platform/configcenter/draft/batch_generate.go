package draft

import (
	"errors"
	"fmt"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 批量「重新生成配置变更单」的单网域结果状态。
const (
	// BatchGenerateStatusGenerated：已生成（或复用）一张待确认变更单，等待人工确认下发。
	BatchGenerateStatusGenerated = "generated"
	// BatchGenerateStatusNoChanges：源数据产物与当前生效版本无差异且未生成变更单。
	// 强制模式（GenerateDraftForce）下理论上不会出现，保留作为生成策略调整时的兜底。
	BatchGenerateStatusNoChanges = "no_changes"
	// BatchGenerateStatusFailed：生成失败（网域未纳管/冻结、产物组装异常等）。
	BatchGenerateStatusFailed = "failed"
)

// BatchGenerateResult 是「按 Job 所属网域批量重新生成变更单」的单网域结果。
type BatchGenerateResult struct {
	NetworkDomainID   string `json:"network_domain_id"`
	Status            string `json:"status"`
	ChangeNo          string `json:"change_no,omitempty"`
	ValidationStatus  string `json:"validation_status,omitempty"`
	ValidationMessage string `json:"validation_message,omitempty"`
	Message           string `json:"message,omitempty"`
}

// BatchGenerateDrafts 按 jobIDs 涉及的全部网域逐域重新生成配置变更单。
//
// 语义（与「批量重新生成并下发」刻意区分）：
//   - **只生成/刷新变更单，不确认下发**；确认动作仍由用户在「配置变更确认」页手动完成；
//   - 强制模式（GenerateDraftForce）：绕过决策 44-3 空跑抑制，即使产物与生效版本一致
//     也生成一张无变更项的待确认草稿；
//   - 已有同 checksum 的活 pending 时幂等复用该单，不重复生成；
//   - 单域失败不影响其它网域（逐域收集结果，顺序按网域 ID 稳定排序）。
func BatchGenerateDrafts(db *gorm.DB, jobIDs []uint) ([]BatchGenerateResult, error) {
	if len(jobIDs) == 0 {
		return nil, fmt.Errorf("job_ids 不能为空")
	}
	var jobs []models.ScrapeJob
	if err := db.Where("id IN ?", jobIDs).Find(&jobs).Error; err != nil {
		return nil, fmt.Errorf("query scrape jobs: %w", err)
	}
	if len(jobs) == 0 {
		return nil, fmt.Errorf("所选采集 Job 不存在或已删除")
	}

	seen := make(map[string]struct{}, len(jobs))
	domainIDs := make([]string, 0, len(jobs))
	for _, j := range jobs {
		if j.NetworkDomainID == "" {
			continue
		}
		if _, ok := seen[j.NetworkDomainID]; ok {
			continue
		}
		seen[j.NetworkDomainID] = struct{}{}
		domainIDs = append(domainIDs, j.NetworkDomainID)
	}
	if len(domainIDs) == 0 {
		return nil, fmt.Errorf("所选采集 Job 未关联任何网域")
	}
	sort.Strings(domainIDs)

	results := make([]BatchGenerateResult, 0, len(domainIDs))
	for _, domainID := range domainIDs {
		results = append(results, generateDomainDraft(db, domainID))
	}
	return results, nil
}

// generateDomainDraft 对单个网域强制生成变更单；所有失败都收敛进返回结果，
// 保证批量任务不被单域异常中断。**不调用 ConfirmDraft**。
func generateDomainDraft(db *gorm.DB, domainID string) BatchGenerateResult {
	res := BatchGenerateResult{NetworkDomainID: domainID}

	d, err := GenerateDraftForce(db, domainID)
	if err != nil {
		// force 模式下理论上不再返回 ErrNoChanges；保留兜底以防未来生成策略调整。
		if errors.Is(err, ErrNoChanges) {
			res.Status = BatchGenerateStatusNoChanges
			return res
		}
		res.Status = BatchGenerateStatusFailed
		res.Message = err.Error()
		return res
	}

	res.Status = BatchGenerateStatusGenerated
	res.ChangeNo = d.ChangeNo
	res.ValidationStatus = d.ValidationStatus
	res.ValidationMessage = d.ValidationMessage
	return res
}

// BatchGenerateRequest 是批量重新生成变更单的请求体。
type BatchGenerateRequest struct {
	JobIDs []uint `json:"job_ids" binding:"required,min=1"`
}

// BatchGenerateService 封装「批量重新生成变更单」用例。
// handler 只依赖该服务，不直接持有 *gorm.DB（架构红线 R1：新增 handler 禁止直接依赖 DB）。
type BatchGenerateService struct {
	db *gorm.DB
}

// NewBatchGenerateService 构造批量生成服务。
func NewBatchGenerateService(db *gorm.DB) *BatchGenerateService {
	return &BatchGenerateService{db: db}
}

// Generate 按所选 Job 所属网域批量生成变更单。
func (s *BatchGenerateService) Generate(jobIDs []uint) ([]BatchGenerateResult, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("batch generate service not initialized")
	}
	return BatchGenerateDrafts(s.db, jobIDs)
}

// BatchGenerateHandler 处理 POST /api/v2/platform/config/drafts/batch-generate。
func BatchGenerateHandler(svc *BatchGenerateService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BatchGenerateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		results, err := svc.Generate(req.JobIDs)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		response.OK(c, gin.H{"results": results})
	}
}
