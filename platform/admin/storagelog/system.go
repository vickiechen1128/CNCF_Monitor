package storagelog

import (
	"os"
	"os/exec"
)

// 已安装的 logrotate 配置路径（交付包 install.sh 引导 cp 到此）。
const installedLogrotateConf = "/etc/logrotate.d/metric-center"

// 开发态 / 包内 logrotate 示例模板（package-center.sh 生成）。
const exampleLogrotateConf = "scripts/logrotate.conf.example"

// maxConfContentBytes 限制展示的配置内容长度，避免响应体膨胀。
const maxConfContentBytes = 8 << 10

// detectLogRotation 探测运行日志轮转策略并生成只读展示信息。
// 与 TSDB 保留策略不同，日志轮转配置的调整不需要重启任何进程（logrotate
// 由 cron/systemd-timer 每日执行，journald 由 systemd 管理），故 Summary
// 中明确标注「免重启生效」。
func detectLogRotation() logRotationInfo {
	// 1) 已安装的 logrotate 配置 → 已生效。
	if content, ok := readConf(installedLogrotateConf); ok {
		return logRotationInfo{
			Mechanism:  "logrotate",
			Active:     true,
			ConfigPath: installedLogrotateConf,
			Content:    content,
			Summary:    "运行日志按 logrotate 策略轮转（每日执行、保留 14 份、压缩存储），修改该配置后下一次轮转周期生效，无需重启任何进程。",
		}
	}

	// 2) 包内示例模板（尚未安装到 /etc/logrotate.d）→ 提示安装路径。
	if content, ok := readConf(exampleLogrotateConf); ok {
		return logRotationInfo{
			Mechanism:  "logrotate",
			Active:     false,
			ConfigPath: exampleLogrotateConf,
			Content:    content,
			Summary:    "检测到 logrotate 示例模板但尚未安装，运行日志当前不会轮转；安装方式：cp " + exampleLogrotateConf + " " + installedLogrotateConf + "（安装后免重启生效）。",
		}
	}

	// 3) journald 兜底：服务由 systemd 承载时运行日志进 journald。
	if _, err := exec.LookPath("journalctl"); err == nil {
		return logRotationInfo{
			Mechanism: "journald",
			Active:    true,
			Summary:   "未检测到 logrotate 配置，运行日志由 journald 承载（journalctl 查看）；SystemMaxUse 等上限在 /etc/systemd/journald.conf 调整后 systemctl restart systemd-journald 生效，不影响 MetricCenter 与 Prometheus。",
		}
	}

	return logRotationInfo{
		Mechanism: "none",
		Active:    false,
		Summary:   "未检测到日志轮转配置（无 logrotate 配置且未发现 journald）；日志将持续增长，建议参照交付包 scripts/logrotate.conf.example 安装轮转策略。",
	}
}

// readConf 读取配置文件内容（截断到 maxConfContentBytes），不存在返回 ok=false。
func readConf(path string) (content string, ok bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	content = string(data)
	if len(content) > maxConfContentBytes {
		content = content[:maxConfContentBytes] + "\n…（内容过长，已截断）"
	}
	return content, true
}
