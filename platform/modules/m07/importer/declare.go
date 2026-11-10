package importer

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"

	"github.com/xuri/excelize/v2"
)

const (
	bizDeclareSheet      = "业务声明"
	appDeclareSheet      = "应用声明"
	platformDeclareSheet = "平台声明"
)

// DeclareEntry is one declaration row.
type DeclareEntry struct {
	Code        string
	Name        string
	Description string
}

// DeclareSheets contains optional dictionary declaration sheets.
type DeclareSheets struct {
	Biz      []DeclareEntry
	App      []DeclareEntry
	Platform []DeclareEntry
}

// Empty reports whether no declarations were provided.
func (s *DeclareSheets) Empty() bool {
	return s == nil || (len(s.Biz) == 0 && len(s.App) == 0 && len(s.Platform) == 0)
}

var declareCodePattern = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)

// ParseDeclareSheets parses the optional 业务声明 / 应用声明 / 平台声明 sheets.
func ParseDeclareSheets(fileBytes []byte) (*DeclareSheets, error) {
	f, err := excelize.OpenReader(bytes.NewReader(fileBytes))
	if err != nil {
		return nil, fmt.Errorf("open xlsx: %w", err)
	}
	defer f.Close()

	out := &DeclareSheets{}
	if out.Biz, err = parseDeclareSheet(f, bizDeclareSheet, "biz_code", "biz_name"); err != nil {
		return nil, err
	}
	if out.App, err = parseDeclareSheet(f, appDeclareSheet, "app_code", "app_name"); err != nil {
		return nil, err
	}
	if out.Platform, err = parseDeclareSheet(f, platformDeclareSheet, "platform_code", "platform_name"); err != nil {
		return nil, err
	}
	return out, nil
}

func parseDeclareSheet(f *excelize.File, sheet, codeHeader, nameHeader string) ([]DeclareEntry, error) {
	if !sheetExists(f, sheet) {
		return nil, nil
	}
	rows, err := f.GetRows(sheet)
	if err != nil {
		return nil, fmt.Errorf("read sheet %q: %w", sheet, err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("sheet %q has no header", sheet)
	}
	header := trimCells(rows[0])
	if len(header) < 2 || header[0] != codeHeader || header[1] != nameHeader {
		return nil, fmt.Errorf("sheet %q header must start with %s,%s", sheet, codeHeader, nameHeader)
	}
	if len(header) > 3 {
		return nil, fmt.Errorf("sheet %q has unexpected column %q", sheet, header[3])
	}
	if len(header) == 3 && header[2] != "说明" {
		return nil, fmt.Errorf("sheet %q third column must be 说明", sheet)
	}

	out := make([]DeclareEntry, 0, len(rows)-1)
	for i := 1; i < len(rows); i++ {
		cells := trimCells(rows[i])
		if allEmpty(cells) {
			continue
		}
		entry := DeclareEntry{Code: cellAt(cells, 0), Name: cellAt(cells, 1), Description: cellAt(cells, 2)}
		out = append(out, entry)
	}
	return out, nil
}

// ValidateDeclarations checks declaration shape, code format and duplicates.
func ValidateDeclarations(sheets *DeclareSheets) error {
	if sheets == nil {
		return nil
	}
	if err := validateDeclareEntries(bizDeclareSheet, sheets.Biz); err != nil {
		return err
	}
	if err := validateDeclareEntries(appDeclareSheet, sheets.App); err != nil {
		return err
	}
	return validateDeclareEntries(platformDeclareSheet, sheets.Platform)
}

func validateDeclareEntries(sheet string, entries []DeclareEntry) error {
	seen := make(map[string]int, len(entries))
	for i, entry := range entries {
		row := i + 2
		code := strings.TrimSpace(entry.Code)
		name := strings.TrimSpace(entry.Name)
		if code == "" {
			return fmt.Errorf("sheet %q row %d: code is required", sheet, row)
		}
		if name == "" {
			return fmt.Errorf("sheet %q row %d: name is required", sheet, row)
		}
		if !declareCodePattern.MatchString(code) {
			return fmt.Errorf("sheet %q row %d: invalid code %q", sheet, row, code)
		}
		if prev, ok := seen[code]; ok {
			return fmt.Errorf("sheet %q duplicate code %q at rows %d and %d", sheet, code, prev, row)
		}
		seen[code] = row
	}
	return nil
}

func sheetExists(f *excelize.File, name string) bool {
	for _, sheet := range f.GetSheetList() {
		if sheet == name {
			return true
		}
	}
	return false
}

func cellAt(cells []string, idx int) string {
	if idx < len(cells) {
		return cells[idx]
	}
	return ""
}
