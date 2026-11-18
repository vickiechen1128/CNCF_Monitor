package handler

import (
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// candidateMaxIDs caps the select-all resolution: silently truncating would let
// the user believe a whole filter result is covered (SRS JG v1.1 NFR-JG-14).
const candidateMaxIDs = 2000

// QueryCandidates handles POST /scrape-jobs/instance-candidates/query.
//
// Composable filters (AND) + per-domain counts; the same endpoint replaces the
// fixed single-domain dropdown (SRS JG v1.1 FR-JG-11/12).
func (h *JobHandler) QueryCandidates(c *gin.Context) {
	var req dto.CandidateQueryRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	page, pageSize := parsePagination(c)
	if req.Page > 0 {
		page = req.Page
	}
	if req.PageSize > 0 {
		pageSize = req.PageSize
	}
	out, err := h.svc.QueryCandidates(requestContext(c), candidateQuery(c, req, page, pageSize))
	if err != nil {
		respondError(c, err)
		return
	}

	list := make([]dto.CandidateResponse, 0, len(out.Views))
	for _, view := range out.Views {
		list = append(list, dto.FromCandidate(view.Ref, view.MonitorType, view.TargetAddress, view.Selectable, view.DisabledReason))
	}
	domains := make([]dto.DomainHitResponse, 0, len(out.Domains))
	for _, hit := range out.Domains {
		domains = append(domains, dto.DomainHitResponse{
			NetworkDomainID:   hit.NetworkDomainID,
			NetworkDomainName: hit.NetworkDomainName,
			Count:             hit.Count,
		})
	}
	response.OK(c, dto.CandidateQueryResponse{
		List: list, Total: out.Total, Page: page, PageSize: pageSize, Domains: domains,
	})
}

// QueryCandidateIDs handles POST /scrape-jobs/instance-candidates/query/ids
// ("select all filtered results"). The cap is returned to the caller so the UI
// can ask the user to narrow the conditions instead of silently dropping rows.
func (h *JobHandler) QueryCandidateIDs(c *gin.Context) {
	var req dto.CandidateIDsRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	query := candidateQuery(c, dto.CandidateQueryRequest{
		MonitorType: req.MonitorType, ResourceCategory: req.ResourceCategory,
		Filters: req.Filters, Keyword: req.Keyword,
	}, 0, 0)
	query.IDsOnly = true
	query.MaxIDs = candidateMaxIDs
	out, err := h.svc.QueryCandidates(requestContext(c), query)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.CandidateIDsResponse{
		IDs: out.IDs, Total: out.Total, Truncated: out.Truncated, MaxIDs: candidateMaxIDs,
	})
}

// CandidateFilterSchema handles GET /scrape-jobs/instance-candidates/filter-schema.
// The schema is server-owned so new filterable fields never require UI changes.
func (h *JobHandler) CandidateFilterSchema(c *gin.Context) {
	schema := service.CandidateFilterSchema()
	fields := make([]dto.CandidateFilterFieldResponse, 0, len(schema))
	for _, field := range schema {
		item := dto.CandidateFilterFieldResponse{
			Key: field.Key, Label: field.Label, Type: field.Type,
			Ops: field.Ops, Source: field.Source, Default: field.Default,
		}
		for _, option := range field.Options {
			item.Options = append(item.Options, dto.CandidateFilterOptionResponse{
				Value: option.Value, Label: option.Label,
			})
		}
		fields = append(fields, item)
	}
	response.OK(c, dto.CandidateFilterSchemaResponse{Fields: fields})
}

func candidateQuery(c *gin.Context, req dto.CandidateQueryRequest, page, pageSize int) domain.CandidateQuery {
	filters := make([]domain.CandidateFilter, 0, len(req.Filters))
	for _, filter := range req.Filters {
		filters = append(filters, domain.CandidateFilter{
			Field:  strings.TrimSpace(filter.Field),
			Op:     domain.CandidateFilterOp(strings.TrimSpace(filter.Op)),
			Values: filter.Values,
		})
	}
	return domain.CandidateQuery{
		MonitorType: strings.TrimSpace(req.MonitorType),
		Category:    domain.ResourceCategory(strings.TrimSpace(req.ResourceCategory)),
		Filters:     filters,
		Keyword:     strings.TrimSpace(req.Keyword),
		TenantIDs:   candidateTenantScope(c),
		Page:        page,
		PageSize:    pageSize,
	}
}

// candidateTenantScope keeps the scope server-owned (fail-closed): a browser may
// narrow the candidate set, never widen it. MVP is single-tenant (all resource
// rows belong to platform_admin), so only non-platform tenants are narrowed.
func candidateTenantScope(c *gin.Context) []string {
	user := auth.CurrentUser(c)
	if user == nil || user.TenantID == "" || user.TenantID == models.PlatformAdminTenantID {
		return nil
	}
	return []string{user.TenantID}
}
