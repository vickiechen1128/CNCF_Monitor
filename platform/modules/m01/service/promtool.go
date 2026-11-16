package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// PromQLChecker validates rule semantics with promtool.
type PromQLChecker interface {
	// Check returns status passed / failed / unavailable plus a detail string.
	Check(ctx context.Context, ruleContent string) (status, detail string)
}

// PromtoolChecker shells out to `promtool check rules`.
type PromtoolChecker struct {
	binary string
}

// NewPromtoolChecker constructs the checker. PROMTOOL_BIN overrides the binary.
func NewPromtoolChecker() *PromtoolChecker {
	binary := strings.TrimSpace(os.Getenv("PROMTOOL_BIN"))
	if binary == "" {
		binary = "promtool"
	}
	return &PromtoolChecker{binary: binary}
}

// Check implements PromQLChecker.
func (c *PromtoolChecker) Check(ctx context.Context, ruleContent string) (string, string) {
	file, err := os.CreateTemp("", "m01-rules-*.yml")
	if err != nil {
		return "unavailable", fmt.Sprintf("create temp rules file: %v", err)
	}
	path := file.Name()
	defer os.Remove(path)
	if _, err := file.WriteString(ruleContent); err != nil {
		_ = file.Close()
		return "unavailable", fmt.Sprintf("write temp rules file: %v", err)
	}
	if err := file.Close(); err != nil {
		return "unavailable", fmt.Sprintf("close temp rules file: %v", err)
	}
	output, err := exec.CommandContext(ctx, c.binary, "check", "rules", path).CombinedOutput()
	if err == nil {
		return "passed", ""
	}
	var execErr *exec.Error
	if errors.As(err, &execErr) {
		return "unavailable", fmt.Sprintf("%s is not executable", c.binary)
	}
	detail := strings.TrimSpace(string(output))
	if len(detail) > 1500 {
		detail = detail[len(detail)-1500:]
	}
	if detail == "" {
		detail = err.Error()
	}
	return "failed", detail
}
