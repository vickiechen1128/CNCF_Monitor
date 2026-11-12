package handler

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m07/importer"
	"github.com/metriccenter/metriccenter/platform/modules/m07/service"
	"github.com/xuri/excelize/v2"
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
	page, pageSize := parsePagination(c)
	total := len(list)
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	response.OK(c, gin.H{
		"list":      list[start:end],
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
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
//
// Default response is the column definition JSON (api-contract §6). When
// `format=xlsx` is supplied, a ready-to-fill workbook with the fixed header is
// returned instead so the UI can offer a one-click template download.
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
	if strings.EqualFold(strings.TrimSpace(c.Query("format")), "xlsx") {
		workbook, err := buildTemplateWorkbook(columns)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s_template.xlsx"`, category))
		c.Data(
			http.StatusOK,
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			workbook,
		)
		return
	}
	sample := make([]string, len(columns))
	response.OK(c, gin.H{"columns": columns, "sample_row": sample})
}

// buildTemplateWorkbook renders the fixed header row into an xlsx workbook.
func buildTemplateWorkbook(columns []string) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()
	const sheet = "模板"
	if err := f.SetSheetName(f.GetSheetName(0), sheet); err != nil {
		return nil, fmt.Errorf("rename worksheet: %w", err)
	}
	for i, column := range columns {
		cell, err := excelize.CoordinatesToCellName(i+1, 1)
		if err != nil {
			return nil, fmt.Errorf("resolve header cell: %w", err)
		}
		if err := f.SetCellValue(sheet, cell, column); err != nil {
			return nil, fmt.Errorf("write header cell: %w", err)
		}
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, fmt.Errorf("encode xlsx template: %w", err)
	}
	return buf.Bytes(), nil
}
