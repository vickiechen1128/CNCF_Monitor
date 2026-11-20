package generator

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

// 目标解析跳过归因的 Reason 取值（见 SkippedInstance）。
const (
	// SkipReasonResourceNotFound：selected_instance_ids 中的资源已不存在（可能已被删除）。
	SkipReasonResourceNotFound = "resource_not_found"
	// SkipReasonAddressEmpty：资源存在但采集地址为空——application 取 endpoint（主机）
	// + port（采集端口）拼接，其余类别取实例 IP。
	SkipReasonAddressEmpty = "address_empty"
	// SkipReasonOffline：资源状态为 offline，按设计排除（M07 §8.1 / 决策 47-1），
	// 属预期行为而非用户配置缺陷。
	SkipReasonOffline = "offline"
)

// SkippedInstance 记录一次目标解析中未进入产物 targets 的实例及其归因。
// 仅用于生成侧校验给出资源级定位（哪个实例、为什么没解析出地址），不做持久化。
type SkippedInstance struct {
	ResourceID string
	Category   string // host/database/middleware/application/generic_target/interface_service；解析不到资源时为空
	Reason     string // resource_not_found / address_empty / offline
	Detail     string // 人类可读补充（如「健康检查地址（health_check_url）为空」）
}

func MarshalTargetGroups(groups []TargetGroup) (string, error) {
	if groups == nil {
		groups = []TargetGroup{}
	}
	b, err := json.MarshalIndent(groups, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal target groups: %w", err)
	}
	return string(b), nil
}

// EnsureTargetsFilename 校验 targets 文件名为纯文件名（review-fix F6 防御纵深）。
// 正常 key 由 normalizeJobFilename 归一为安全名，但写入点复用 map key：若 DB/下游存入
// 脏 key（含 .. / 路径分隔符）可越界写文件。落盘前在各写入点二次断言兜底。
// 允许 base 名等于自身（无嵌套路径）且不含 '/' 与 '\'；拒绝空 / "." / ".."。
func EnsureTargetsFilename(name string) error {
	if name == "" || name == "." || name == ".." {
		return fmt.Errorf("unsafe targets filename: %q", name)
	}
	if filepath.Base(name) != name || strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("unsafe targets filename (path separators): %q", name)
	}
	return nil
}
