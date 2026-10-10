package seed

import (
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runScrapeJobMetricsPathBackfill 把采集路径 metrics_path 带首尾空白的历史脏数据
// 一次性 trim 对齐。
//
// 背景：采集 Job 的创建 / 更新链路早期只对 metrics_path 做「判空」校验
// （strings.TrimSpace(...) == ""）而不写回归一后的值，且层叠默认回落只认严格空串，
// 于是 " /actuator/prometheus" 这类「非空但带首尾空白」的路径被原样落库。
// 该路径会被拼进 vmagent 抓取 URL 原样发往被采集端，生成
// " http://10.10.1.4:8081/actuator/prometheus" 这样的非法请求 → 目标应用 404 →
// 中心 Prometheus instance=... up=0 且无任何业务样本，而用户在界面上看到的路径
// 「看起来是对的」，表现为"已经改了但还是采不到"。
//
// 保存链路已由 scrapejob.normalizeScrapePath 归一（create/update/draft/批量提交
// 生效均覆盖），本函数只负责修正**存量**行。
//
// 幂等：仅命中 metrics_path <> trim(metrics_path) 的行，重复执行不产生变更。
// trim 后为空串的行不会被写成空串之外的值，也不改变「留空=继承下层默认」的语义
// （空串保持空串，由 resolveJobScrapeParams 在下次保存时按F-28 解析）。
func runScrapeJobMetricsPathBackfill(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("backfill scrape job metrics_path: nil database connection")
	}
	var jobs []models.ScrapeJob
	if err := db.Where("metrics_path IS NOT NULL AND metrics_path <> '' AND metrics_path <> TRIM(metrics_path)").
		Find(&jobs).Error; err != nil {
		return fmt.Errorf("query scrape jobs with untrimmed metrics_path: %w", err)
	}
	for i := range jobs {
		want := strings.TrimSpace(jobs[i].MetricsPath)
		if err := db.Model(&models.ScrapeJob{}).
			Where("id = ?", jobs[i].ID).
			Update("metrics_path", want).Error; err != nil {
			return fmt.Errorf("backfill scrape job %d metrics_path: %w", jobs[i].ID, err)
		}
	}
	return nil
}