package handler

import (
	"fmt"
	"io"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m07/importer"
	"github.com/metriccenter/metriccenter/platform/modules/m07/service"
)

const maxImportFileSize = 10 << 20

// ImportHandler exposes the v3 import API.
type ImportHandler struct {
	svc *service.ImportService
}

// NewImportHandler constructs an import handler.
func NewImportHandler(svc *service.ImportService) *ImportHandler {
	return &ImportHandler{svc: svc}
}

// Import handles POST /resources/import.
func (h *ImportHandler) Import(c *gin.Context) {
	category, err := domain.ParseCategory(c.PostForm("resource_category"))
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	mode := domain.ImportMode(strings.TrimSpace(c.PostForm("mode")))
	if mode == "" {
		mode = domain.ImportModeCreateOnly
	}
	if mode != domain.ImportModeCreateOnly && mode != domain.ImportModeUpsert {
		response.BadRequest(c, fmt.Errorf("mode must be create_only or upsert"))
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		response.BadRequest(c, fmt.Errorf("file is required"))
		return
	}
	if fileHeader.Size > maxImportFileSize {
		response.BadRequest(c, fmt.Errorf("file is too large (max 10MB)"))
		return
	}
	if !strings.HasSuffix(strings.ToLower(fileHeader.Filename), ".xlsx") {
		response.BadRequest(c, fmt.Errorf("file must be .xlsx"))
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		response.BadRequest(c, fmt.Errorf("open uploaded file: %w", err))
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		response.BadRequest(c, fmt.Errorf("read uploaded file: %w", err))
		return
	}

	operator := auth.CurrentUsername(c)
	if operator == "" {
		operator = "platform_admin"
	}
	record, err := h.svc.Import(c.Request.Context(), category, mode, data, operator)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromImportRecord(record))
}

// List handles GET /imports.
func (h *ImportHandler) List(c *gin.Context) {
	records, err := h.svc.List(
		c.Request.Context(),
		strings.TrimSpace(c.Query("resource_category")),
		strings.TrimSpace(c.Query("status")),
	)
	if err != nil {
		respondError(c, err)
		return
	}
	list := dto.FromImportRecords(records)
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

// Get handles GET /imports/:import_id.
func (h *ImportHandler) Get(c *gin.Context) {
	importID := strings.TrimSpace(c.Param("import_id"))
	if importID == "" {
		response.BadRequest(c, fmt.Errorf("import_id is required"))
		return
	}
	record, err := h.svc.Get(c.Request.Context(), importID)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromImportRecord(record))
}

// DownloadTemplate handles GET /resources/import-templates/:resource_category.
func (h *ImportHandler) DownloadTemplate(c *gin.Context) {
	category, err := domain.ParseCategory(c.Param("resource_category"))
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	columns, ok := importer.ColumnsFor(category)
	if !ok {
		response.NotFound(c, fmt.Sprintf("unknown resource_category %q", category))
		return
	}
	sample := make([]string, len(columns))
	response.OK(c, gin.H{"columns": columns, "sample_row": sample})
}
