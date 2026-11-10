// Package importer parses and validates M07 Excel imports.
package importer

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/xuri/excelize/v2"
)

// Row is one parsed Excel data row.
type Row struct {
	RowNumber int
	Category  domain.Category

	NetworkDomain  string
	InstanceName   string
	Hostname       string
	InstanceIP     string
	OSType         string
	DatabaseType   string
	MiddlewareType string
	ServiceName    string
	HealthCheckURL string
	Protocol       string
	Endpoint       string
	TargetName     string
	MetricsPath    string
	Scheme         string
	ExporterType   string
	APIName        string
	APIURL         string

	BizCode      string
	AppCode      string
	PlatformCode string
	Env          string
	Cluster      string
	Owner        string
	Status       string

	Port             int
	PortRaw          string
	ScrapePort       int
	Version          string
	Owner1           string
	Owner1Contact    string
	Owner2           string
	Owner2Contact    string
	GoLiveAt         string
	ActivatedAt      string
	OpsPerson        string
	OpsPersonContact string
	CustomLabelsRaw  string
}

// ParseExcel parses the first sheet using the category's fixed template.
func ParseExcel(fileBytes []byte, category domain.Category) ([]Row, error) {
	expected, ok := ColumnsFor(category)
	if !ok {
		return nil, &domain.UnsupportedCategoryError{Category: string(category)}
	}
	f, err := excelize.OpenReader(bytes.NewReader(fileBytes))
	if err != nil {
		return nil, fmt.Errorf("open xlsx: %w", err)
	}
	defer f.Close()

	sheet := f.GetSheetName(0)
	if sheet == "" {
		return nil, fmt.Errorf("excel has no worksheet")
	}
	rows, err := f.GetRows(sheet)
	if err != nil {
		return nil, fmt.Errorf("read worksheet: %w", err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("excel has no header row")
	}
	if err := validateHeader(rows[0], expected); err != nil {
		return nil, err
	}

	out := make([]Row, 0, len(rows)-1)
	for i := 1; i < len(rows); i++ {
		cells := trimCells(rows[i])
		if allEmpty(cells) {
			continue
		}
		row := Row{RowNumber: i + 1, Category: category}
		applyCells(&row, rows[0], cells)
		out = append(out, row)
	}
	return out, nil
}

func validateHeader(header, expected []string) error {
	kept := make([]string, 0, len(header))
	for _, col := range header {
		col = strings.TrimSpace(col)
		if removedColumns[col] {
			continue
		}
		kept = append(kept, col)
	}
	for len(expected) > 0 && optionalColumns[expected[len(expected)-1]] {
		expected = expected[:len(expected)-1]
	}
	for len(kept) > 0 && optionalColumns[kept[len(kept)-1]] {
		kept = kept[:len(kept)-1]
	}
	for i, want := range expected {
		if i >= len(kept) {
			return fmt.Errorf("excel header missing column %d: want %q", i+1, want)
		}
		if kept[i] != want {
			return fmt.Errorf("excel header column %d: want %q, got %q", i+1, want, kept[i])
		}
	}
	if len(kept) > len(expected) {
		return fmt.Errorf("excel header has unexpected column %q", kept[len(expected)])
	}
	return nil
}

func applyCells(row *Row, header, cells []string) {
	for idx, col := range header {
		val := ""
		if idx < len(cells) {
			val = strings.TrimSpace(cells[idx])
		}
		switch col {
		case "network_domain":
			row.NetworkDomain = val
		case "instance_name":
			row.InstanceName = val
		case "hostname":
			row.Hostname = val
		case "instance_ip":
			row.InstanceIP = val
		case "os_type":
			row.OSType = val
		case "database_type":
			row.DatabaseType = val
		case "middleware_type":
			row.MiddlewareType = val
		case "service_name":
			row.ServiceName = val
		case "health_check_url":
			row.HealthCheckURL = val
		case "protocol":
			row.Protocol = val
		case "endpoint":
			row.Endpoint = val
		case "target_name":
			row.TargetName = val
		case "metrics_path":
			row.MetricsPath = val
		case "scheme":
			row.Scheme = val
		case "exporter_type":
			row.ExporterType = val
		case "api_name":
			row.APIName = val
		case "api_url":
			row.APIURL = val
		case "biz_code":
			row.BizCode = val
		case "app_code":
			row.AppCode = val
		case "platform_code":
			row.PlatformCode = val
		case "env":
			row.Env = val
		case "cluster":
			row.Cluster = val
		case "owner":
			row.Owner = val
		case "status":
			row.Status = val
		case "port":
			row.Port, row.PortRaw = parsePort(val)
		case "scrape_port":
			row.ScrapePort, _ = parsePort(val)
		case "version":
			row.Version = val
		case "owner1":
			row.Owner1 = val
		case "owner1_contact":
			row.Owner1Contact = val
		case "owner2":
			row.Owner2 = val
		case "owner2_contact":
			row.Owner2Contact = val
		case "go_live_at":
			row.GoLiveAt = val
		case "activated_at":
			row.ActivatedAt = val
		case "ops_person":
			row.OpsPerson = val
		case "ops_person_contact":
			row.OpsPersonContact = val
		case "custom_labels":
			row.CustomLabelsRaw = val
		case "zone_env":
			// Deprecated; ignored.
		}
	}
}

func parsePort(raw string) (int, string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, ""
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return -1, raw
	}
	return n, raw
}

func trimCells(cells []string) []string {
	out := make([]string, len(cells))
	for i, c := range cells {
		out[i] = strings.TrimSpace(c)
	}
	return out
}

func allEmpty(cells []string) bool {
	for _, c := range cells {
		if strings.TrimSpace(c) != "" {
			return false
		}
	}
	return true
}
