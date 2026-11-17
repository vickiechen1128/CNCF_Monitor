package service

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// ConfigChecker validates a generated alertmanager.yml before it may become the
// current snapshot.
type ConfigChecker interface {
	// Check returns nil when the configuration is valid. Invalid configuration
	// yields *domain.ConfigValidationError with line-level issues; a missing or
	// broken tool yields *domain.UnavailableError (HTTP 503, retryable, D48).
	Check(ctx context.Context, content string) error
}

// amtoolTimeout bounds the external check so a hung binary cannot block a save.
const amtoolTimeout = 10 * time.Second

// linePattern extracts a line number from common amtool / yaml error shapes.
var linePattern = regexp.MustCompile(`:\s*(\d+)\s*:|\bline\s+(\d+)\b`)

// AmtoolChecker runs `amtool check-config` on a temp file. The binary is
// resolved lazily so a missing tool degrades to 503 instead of a boot failure.
type AmtoolChecker struct {
	lookPath func(string) (string, error)
	run      func(ctx context.Context, bin, configPath string) (string, error)
	timeout  time.Duration
}

// NewAmtoolChecker constructs the default checker.
func NewAmtoolChecker() *AmtoolChecker {
	return &AmtoolChecker{
		lookPath: exec.LookPath,
		run: func(ctx context.Context, bin, configPath string) (string, error) {
			cmd := exec.CommandContext(ctx, bin, "check-config", configPath)
			out, err := cmd.CombinedOutput()
			return string(out), err
		},
		timeout: amtoolTimeout,
	}
}

// NewAmtoolCheckerWith overrides the binary resolution and runner (tests).
func NewAmtoolCheckerWith(lookPath func(string) (string, error), run func(ctx context.Context, bin, configPath string) (string, error)) *AmtoolChecker {
	return &AmtoolChecker{lookPath: lookPath, run: run, timeout: amtoolTimeout}
}

// Check implements ConfigChecker.
func (c *AmtoolChecker) Check(ctx context.Context, content string) error {
	bin, err := c.lookPath("amtool")
	if err != nil {
		return &domain.UnavailableError{
			Message: "amtool 不可用，无法校验 alertmanager.yml；请确认部署环境已提供 Alertmanager CLI（D48）",
		}
	}
	dir, err := os.MkdirTemp("", "m08-amcheck-*")
	if err != nil {
		return fmt.Errorf("create validation temp dir: %w", err)
	}
	defer os.RemoveAll(dir)
	configPath := filepath.Join(dir, "alertmanager.yml")
	if err := os.WriteFile(configPath, []byte(content), 0o600); err != nil {
		return fmt.Errorf("write validation temp file: %w", err)
	}

	runCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	output, runErr := c.run(runCtx, bin, configPath)

	if strings.Contains(output, "SUCCESS") {
		return nil
	}
	if runErr != nil && !strings.Contains(output, "FAILED") {
		return &domain.UnavailableError{
			Message: "amtool 执行失败，无法完成校验：" + runErr.Error(),
		}
	}
	return &domain.ConfigValidationError{
		Cause: domain.ValidationCauseUserConfig,
		Note:  "校验失败，配置未保存、未生效；修改后请重新保存",
		Items: parseAmtoolIssues(output),
	}
}

// parseAmtoolIssues converts amtool output into line-level issues.
func parseAmtoolIssues(output string) []domain.ValidationIssue {
	issues := make([]domain.ValidationIssue, 0, 4)
	for _, raw := range strings.Split(strings.TrimSpace(output), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if marker := strings.Index(line, "FAILED:"); marker >= 0 {
			line = strings.TrimSpace(line[marker+len("FAILED:"):])
		} else if index := strings.Index(line, "SUCCESS"); index >= 0 {
			continue
		} else if strings.Contains(line, "Checking '") {
			continue
		}
		if line == "" {
			continue
		}
		issues = append(issues, domain.ValidationIssue{
			Line:    extractLineNumber(line),
			Message: strings.Trim(strings.TrimSpace(line), ": "),
		})
	}
	if len(issues) == 0 {
		issues = append(issues, domain.ValidationIssue{
			Message: "alertmanager.yml 校验失败（amtool 未返回可解析的错误）",
		})
	}
	return issues
}

func extractLineNumber(line string) int {
	match := linePattern.FindStringSubmatch(line)
	if match == nil {
		return 0
	}
	for _, candidate := range match[1:] {
		if candidate == "" {
			continue
		}
		if value, err := strconv.Atoi(candidate); err == nil {
			return value
		}
	}
	return 0
}
