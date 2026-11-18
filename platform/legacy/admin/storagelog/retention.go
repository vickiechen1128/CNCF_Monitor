// Package storagelog 实现 M06「存储与日志管理」页（dev-feedback F-41）：
//   - 中心 Prometheus TSDB 保留策略前台读写：写 prom-retention.env，重启后生效；
//     Prometheus 不支持 retention 热更新（--web.enable-lifecycle reload 只覆盖
//     prometheus.yml），故与运行时参数做归一化比对得出「待重启生效」状态；
//   - TSDB / 日志目录磁盘占用只读展示；
//   - 运行日志轮转策略展示（logrotate，免重启）。
//
// 越权重启 Prometheus 按钮刻意不做（决策 64 职责分离），由前端展示运维重启指引。
package storagelog

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// env 文件中的键名，与 Makefile run-prometheus、交付包 start.sh 的取值变量一致。
const (
	envKeyTime = "PROM_RETENTION_TIME"
	envKeySize = "PROM_RETENTION_SIZE"
)

// RetentionValues 是保留策略二元组（time 与 size 的原始字符串形态）。
type RetentionValues struct {
	Time string `json:"time"`
	Size string `json:"size"`
}

// 持久时长格式：Prometheus model.Duration 的单位序列（y/w/d/h/m/s/ms 组合）。
// "ms" 必须排在 "m" 之前，避免前缀误切。
var durFormat = regexp.MustCompile(`^([0-9]+(ms|y|w|d|h|m|s))+$`)

var durSegments = regexp.MustCompile(`([0-9]+)(ms|y|w|d|h|m|s)`)

var durUnit = map[string]time.Duration{
	"y":  365 * 24 * time.Hour,
	"w":  7 * 24 * time.Hour,
	"d":  24 * time.Hour,
	"h":  time.Hour,
	"m":  time.Minute,
	"s":  time.Second,
	"ms": time.Millisecond,
}

// 容量格式：数字 + 单位（单位表见 units.ParseBase2Bytes 支持范围）。
var sizeFormat = regexp.MustCompile(`^([0-9]+)([A-Za-z]+)$`)

// 容量单位均按 1024 进制折算（对齐 Prometheus --storage.tsdb.retention.size
// 「Based on powers-of-2」，2GB 与 2GiB 同值）。kB 等 SI 小写形式刻意不收，
// 与 Prometheus 自身的拒绝口径一致。
var sizeUnit = map[string]int64{
	"B":   1,
	"KB":  1 << 10,
	"MB":  1 << 20,
	"GB":  1 << 30,
	"TB":  1 << 40,
	"PB":  1 << 50,
	"EB":  1 << 60,
	"KiB": 1 << 10,
	"MiB": 1 << 20,
	"GiB": 1 << 30,
	"TiB": 1 << 40,
	"PiB": 1 << 50,
	"EiB": 1 << 60,
}

// ValidateRetentionTime 校验保留时长（用户输入面）：须为 Prometheus duration
// 单位序列，如 15d、1h30m、30m。
func ValidateRetentionTime(s string) error {
	if !durFormat.MatchString(s) {
		return fmt.Errorf("保留时长格式无效：%q（需为 15d / 1h30m 这类单位序列，支持 y、w、d、h、m、s、ms）", s)
	}
	if _, err := parsePromDuration(s); err != nil {
		return err
	}
	return nil
}

// ValidateRetentionSize 校验保留容量：数字 + 单位（B/KB/MB/GB/TB/PB/EB 及 iB 变体）。
func ValidateRetentionSize(s string) error {
	if _, err := parsePromBytes(s); err != nil {
		return err
	}
	return nil
}

// parsePromDuration 将 Prometheus duration 字符串解析为 time.Duration。
// 供与运行时 flags 值做归一化比对（如输入 360h 与运行时 15d 视为同值）。
func parsePromDuration(s string) (time.Duration, error) {
	if !durFormat.MatchString(s) {
		return 0, fmt.Errorf("无效的 Prometheus duration: %q", s)
	}
	var total time.Duration
	for _, seg := range durSegments.FindAllStringSubmatch(s, -1) {
		n, err := strconv.ParseInt(seg[1], 10, 64)
		if err != nil {
			return 0, fmt.Errorf("无效的 Prometheus duration: %q", s)
		}
		total += time.Duration(n) * durUnit[seg[2]]
	}
	return total, nil
}

// parsePromBytes 将容量字符串解析为字节数（1024 进制）。
// 运行时 flags 经 units.Base2Bytes.String() 序列化为 "2GiB" 形态，
// 与用户输入的 "2GB" 必须折算为同值后比较，否则会误报「待重启」。
func parsePromBytes(s string) (int64, error) {
	m := sizeFormat.FindStringSubmatch(s)
	if m == nil {
		return 0, fmt.Errorf("保留容量格式无效：%q（需为 10GB 这类整数 + 单位，支持 B/KB/MB/GB/TB/PB/EB）", s)
	}
	mult, ok := sizeUnit[m[2]]
	if !ok {
		return 0, fmt.Errorf("保留容量单位无效：%q（支持 B/KB/MB/GB/TB/PB/EB）", m[2])
	}
	n, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("保留容量数值无效：%q", s)
	}
	return n * mult, nil
}

// valuesEqual 判断两组保留策略是否语义同值（归一化后比较，任一侧解析失败
// 时回退字符串比较，保证不误判为「已生效」）。
func valuesEqual(a, b RetentionValues) bool {
	return durationEqual(a.Time, b.Time) && bytesEqual(a.Size, b.Size)
}

func durationEqual(a, b string) bool {
	da, errA := parsePromDuration(a)
	db, errB := parsePromDuration(b)
	if errA != nil || errB != nil {
		return a == b
	}
	return da == db
}

func bytesEqual(a, b string) bool {
	ba, errA := parsePromBytes(a)
	bb, errB := parsePromBytes(b)
	if errA != nil || errB != nil {
		return a == b
	}
	return ba == bb
}

// readRetentionPolicy 读取 env 文件中的保留策略。found=false 表示文件不存在
// 或未含任何键（此时 desired 回落运行时值，source=startup_default）。
func readRetentionPolicy(path string) (vals RetentionValues, found bool, err error) {
	data, rerr := os.ReadFile(path)
	if os.IsNotExist(rerr) {
		return RetentionValues{}, false, nil
	}
	if rerr != nil {
		return RetentionValues{}, false, fmt.Errorf("读取保留策略文件失败: %w", rerr)
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch strings.TrimSpace(k) {
		case envKeyTime:
			vals.Time = strings.TrimSpace(v)
			found = true
		case envKeySize:
			vals.Size = strings.TrimSpace(v)
			found = true
		}
	}
	return vals, found, nil
}

// writeRetentionPolicy 原子写入 env 文件（临时文件 + rename），键序固定。
func writeRetentionPolicy(path string, vals RetentionValues) error {
	content := "# MetricCenter TSDB 保留策略（由「存储与日志管理」页写入，重启 Prometheus 后生效）\n" +
		"# 手工修改会在下次页面保存时被覆盖。\n" +
		envKeyTime + "=" + vals.Time + "\n" +
		envKeySize + "=" + vals.Size + "\n"

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("创建配置目录失败: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".prom-retention-*.env")
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // rename 成功后 Remove 自然失败，忽略

	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return fmt.Errorf("写入保留策略失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("写入保留策略失败: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("落盘保留策略失败: %w", err)
	}
	return nil
}
