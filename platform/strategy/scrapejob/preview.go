package scrapejob

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/configcenter/portchain"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// previewTarget 是 preview-targets 解析后的单个目标。
type previewTarget struct {
	ResourceID string `json:"resource_id,omitempty"`
	Address    string `json:"address"` // standard→实例地址；blackbox→target
	Protocol   string `json:"protocol,omitempty"`
	// Port/PortSource 是 standard 目标的生效端口与来源（提案
	// resource-scrape-port-chain §5.3 抽屉只读回显）：来源枚举
	// instance/mapping/template/business/unresolved（portchain.Source*）。
	// blackbox 分支无端口解析概念（D3 矩阵），保持零值（port=0、port_source=""）。
	Port       int    `json:"port"`
	PortSource string `json:"port_source"`
}

// PreviewTargets 是 POST /api/v2/platform/scrape-jobs/:id/preview-targets 的
// handler：解析该 Job 的目标清单。standard→已选实例地址（host PrivateIP /
// database InstanceIP / middleware InstanceIP / application endpoint:port /
// generic_target InstanceIP）；blackbox→blackbox_targets（api-contract-snapshot §6,
// L2 接口预览）。Job 未命中 not_found。
func PreviewTargets(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseJobID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}
		var job models.ScrapeJob
		if err := db.First(&job, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("scrape job %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get scrape job %d: %w", id, err))
			return
		}

		if job.JobType == models.JobTypeBlackbox {
			items := make([]previewTarget, 0, len(job.BlackboxTargets))
			for _, t := range job.BlackboxTargets {
				items = append(items, previewTarget{Address: t.Target, Protocol: string(t.Protocol)})
			}
			response.OK(c, gin.H{"targets": items})
			return
		}

		items := make([]previewTarget, 0, len(job.SelectedInstanceIDs))
		for _, rid := range job.SelectedInstanceIDs {
			addr := resolveInstanceAddress(db, rid)
			port, source := resolveInstanceScrapePort(db, &job, rid)
			items = append(items, previewTarget{ResourceID: rid, Address: addr, Port: port, PortSource: source})
		}
		response.OK(c, gin.H{"targets": items})
	}
}

// applicationTargetAddress 组合 application 的采集地址 `endpoint:port`（port 缺省时
// 仅返回 endpoint）。与 M09 生成器（configcenter/generator/targets.go 对 application 取
// endpoint + port 拼接）同口径，保证「实例候选 / 目标预览 / 安装确认」展示的地址与
// 最终下发 target 一致。
func applicationTargetAddress(a *models.Application) string {
	if a == nil {
		return ""
	}
	if a.Port <= 0 {
		return a.Endpoint
	}
	return fmt.Sprintf("%s:%d", a.Endpoint, a.Port)
}

// resolveInstanceAddress 根据 resource_id 在五类资源表中查找该实例地址；
// 未命中返回空字符串。
func resolveInstanceAddress(db *gorm.DB, resourceID string) string {
	var host models.Host
	if err := db.Where("resource_id = ?", resourceID).First(&host).Error; err == nil {
		return host.PrivateIP
	}
	var database models.Database
	if err := db.Where("resource_id = ?", resourceID).First(&database).Error; err == nil {
		return database.InstanceIP
	}
	var middleware models.Middleware
	if err := db.Where("resource_id = ?", resourceID).First(&middleware).Error; err == nil {
		return middleware.InstanceIP
	}
	var application models.Application
	if err := db.Where("resource_id = ?", resourceID).First(&application).Error; err == nil {
		return applicationTargetAddress(&application)
	}
	var generic models.GenericTarget
	if err := db.Where("resource_id = ?", resourceID).First(&generic).Error; err == nil {
		return generic.InstanceIP
	}
	return ""
}

// resolveInstanceScrapePort 按四级端口解析链计算某实例的生效端口与来源
// （提案 resource-scrape-port-chain §5.1 / §5.3 抽屉只读回显；preview-targets
// 与 instances 共用此函数，保证两处回显同源）。
//
// 本函数只负责**分层加载入参**，优先级判定一律交由 portchain.Resolve 完成
// （决策 D-2=B：scrapejob 包内不复制第二套解析逻辑）：
//   - 实例层：资源行 scrape_port；application/generic_target 端口是资源自身
//     属性（D3a/D3b），直接按资源行 port 走 Resolve(port, 0, 0, 0)，不进采集器链；
//   - 映射层：CITypeExporterMapping（monitor_type + is_default=true 的
//     default_port，与 resolveJobScrapeParams / generator LoadExporterPort 同口径）；
//   - 模板层：ExporterTemplate.default_port（按 job.ExporterTemplateID，与
//     generator LoadExporterPort 同口径，保证回显端口与下发 target 端口一致）；
//   - 业务层：仅 database/middleware 传业务 port，host 第 4 参恒 0（拍板 Q1，
//     host 永不产生 business 来源）。
//
// 全 0 → (0, portchain.SourceUnresolved)，地址保持裸 IP、前端展示 "-"（§9 失败态
// 口径）；business 来源仅前端警示、后端不阻断（决策 D-4）。资源未命中（preview
// 不过滤失效引用）按全 0 归一返回 unresolved。
func resolveInstanceScrapePort(db *gorm.DB, job *models.ScrapeJob, resourceID string) (int, string) {
	// host / database / middleware：进入四级链（探测顺序与 resolveInstanceAddress
	// 一致，保证地址与端口取自同一张表）。
	scrapePort, businessPort, found := 0, 0, false
	var host models.Host
	if err := db.Where("resource_id = ?", resourceID).First(&host).Error; err == nil {
		scrapePort, found = host.ScrapePort, true // host 无业务 port，第 4 参恒 0（Q1）
	}
	if !found {
		var database models.Database
		if err := db.Where("resource_id = ?", resourceID).First(&database).Error; err == nil {
			scrapePort, businessPort, found = database.ScrapePort, database.Port, true
		}
	}
	if !found {
		var middleware models.Middleware
		if err := db.Where("resource_id = ?", resourceID).First(&middleware).Error; err == nil {
			scrapePort, businessPort, found = middleware.ScrapePort, middleware.Port, true
		}
	}
	if !found {
		// application / generic_target：资源自身端口即采集端口（D3a/D3b），
		// 不经映射/模板层，按资源行 port 走 Resolve(port, 0, 0, 0)。
		var application models.Application
		if err := db.Where("resource_id = ?", resourceID).First(&application).Error; err == nil {
			return portchain.Resolve(application.Port, 0, 0, 0)
		}
		var generic models.GenericTarget
		if err := db.Where("resource_id = ?", resourceID).First(&generic).Error; err == nil {
			return portchain.Resolve(generic.Port, 0, 0, 0)
		}
		// 资源不存在（软删/失效引用）：按全 0 归一 → unresolved。
		return portchain.Resolve(0, 0, 0, 0)
	}
	return portchain.Resolve(scrapePort, mappingDefaultPort(db, job), templateDefaultPort(db, job), businessPort)
}

// mappingDefaultPort 加载类型映射层端口：该 monitor_type 的 is_default=true
// 行的 default_port；无映射或留空（0）返回 0（由 portchain 向下回落）。
// 查询口径与 resolveJobScrapeParams / generator LoadExporterPort 严格一致。
func mappingDefaultPort(db *gorm.DB, job *models.ScrapeJob) int {
	if job.MonitorType == "" {
		return 0
	}
	var m models.CITypeExporterMapping
	if err := db.Where("monitor_type = ? AND is_default = ?", job.MonitorType, true).
		First(&m).Error; err != nil {
		return 0
	}
	return m.DefaultPort
}

// templateDefaultPort 加载采集器模板层端口（job.ExporterTemplateID 的
// default_port）；未挂载模板或留空（0）返回 0。刻意**不含**「映射引用的
// 采集器回落」——与 generator LoadExporterPort 口径逐字对齐，保证回显端口
// 与最终下发 target 端口一致。
func templateDefaultPort(db *gorm.DB, job *models.ScrapeJob) int {
	if job.ExporterTemplateID == "" {
		return 0
	}
	var tmpl models.ExporterTemplate
	if err := db.Where("id = ?", job.ExporterTemplateID).First(&tmpl).Error; err != nil {
		return 0
	}
	return tmpl.DefaultPort
}
