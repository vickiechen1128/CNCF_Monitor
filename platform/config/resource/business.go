// Package resource implements Module 07 监控对象管理的支撑层：业务分组字典、
// 资源校验与查询辅助等。本文件提供业务分组字典 business_domains.yaml 的
// 内存加载、热加载与只读访问。
package resource

import (
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"gopkg.in/yaml.v3"
)

// BusinessDomain 是业务分组字典的一条条目。
//
//   - code        不可变主键（biz_code），永不可改、停用不删除（PRD §3.1 红线）；
//   - name        展示名（biz_name），可改，仅 UI 展示；
//   - description 描述，可改；
//   - enabled     启用状态；停用条目不可被新资源/新增/编辑选用，存量资源保留历史值。
type BusinessDomain struct {
	Code        string `json:"code" yaml:"code"`
	Name        string `json:"name" yaml:"name"`
	Description string `json:"description" yaml:"description"`
	Enabled     bool   `json:"enabled" yaml:"enabled"`
}

// BusinessDomainStore 从 yaml 文件加载业务分组字典并缓存为内存快照。
//
// 热加载：每次读取前比较文件 mtime，变更后自动重读（MVP P0 验收项，无需重启）。
// 容错：加载失败返回错误并保留上次成功快照，读取路径不会 panic。
type BusinessDomainStore struct {
	path string
	mu   sync.Mutex

	// 内存快照（仅在加载成功时整体替换，失败保留旧值）。
	domains map[string]BusinessDomain // code -> 条目
	order   []string                  // 文件顺序，保证列表输出稳定
	mtime   time.Time                 // 上次成功加载时的文件 mtime
	loaded  bool                      // 是否已有成功快照
	lastErr error                     // 最近一次加载错误（成功为 nil）
}

// NewBusinessDomainStore 构造并尝试首次加载。构造函数不返回错误：文件缺失或
// 解析失败时进入降级状态（读取返回错误 + 空快照），保证 metric-center 仍能启动。
func NewBusinessDomainStore(path string) *BusinessDomainStore {
	s := &BusinessDomainStore{
		path:    path,
		domains: make(map[string]BusinessDomain),
	}
	s.mu.Lock()
	_ = s.ensureLoadedLocked()
	s.mu.Unlock()
	return s
}

// List 返回全量字典条目（含停用项，按文件顺序）。加载失败时返回上次快照与错误。
func (s *BusinessDomainStore) List() ([]BusinessDomain, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.ensureLoadedLocked()
	out := make([]BusinessDomain, 0, len(s.order))
	for _, code := range s.order {
		out = append(out, s.domains[code])
	}
	return out, err
}

// Lookup 按 code 查找条目。ok=false 表示不存在；err 非 nil 表示热加载失败
// （仍返回上次快照中的结果）。
func (s *BusinessDomainStore) Lookup(code string) (BusinessDomain, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.ensureLoadedLocked()
	d, ok := s.domains[code]
	return d, ok, err
}

// EnabledList 返回启用条目（停用项不进入，PRD §3.1）。
func (s *BusinessDomainStore) EnabledList() ([]BusinessDomain, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.ensureLoadedLocked()
	out := make([]BusinessDomain, 0)
	for _, code := range s.order {
		if d := s.domains[code]; d.Enabled {
			out = append(out, d)
		}
	}
	return out, err
}

// GetEnabledMap 返回启用条目映射 code -> BusinessDomain，供资源校验
// （biz_code 必填且对应启用条目，T07-03/T07-06）。
func (s *BusinessDomainStore) GetEnabledMap() (map[string]BusinessDomain, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.ensureLoadedLocked()
	out := make(map[string]BusinessDomain)
	for _, code := range s.order {
		if d := s.domains[code]; d.Enabled {
			out[code] = d
		}
	}
	return out, err
}

// ensureLoadedLocked 检查文件 mtime，若已变更则重载；调用方需持有 s.mu。
func (s *BusinessDomainStore) ensureLoadedLocked() error {
	info, err := os.Stat(s.path)
	if err != nil {
		s.lastErr = fmt.Errorf("stat business domains file %s: %w", s.path, err)
		return s.lastErr
	}
	if s.loaded && info.ModTime() == s.mtime {
		return s.lastErr
	}
	return s.reloadLocked(info)
}

// reloadLocked 读取并解析 yaml，仅成功后整体替换内存快照；失败保留上次快照
// 并记录错误。调用方需持有 s.mu。
func (s *BusinessDomainStore) reloadLocked(info os.FileInfo) error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		s.lastErr = fmt.Errorf("read business domains file %s: %w", s.path, err)
		return s.lastErr
	}
	var entries []BusinessDomain
	if err := yaml.Unmarshal(data, &entries); err != nil {
		s.lastErr = fmt.Errorf("parse business domains file %s: %w", s.path, err)
		return s.lastErr
	}

	domains := make(map[string]BusinessDomain, len(entries))
	order := make([]string, 0, len(entries))
	for _, d := range entries {
		if d.Code == "" {
			s.lastErr = fmt.Errorf("business domains file %s: entry missing code", s.path)
			return s.lastErr
		}
		if _, dup := domains[d.Code]; dup {
			s.lastErr = fmt.Errorf("business domains file %s: duplicate code %q", s.path, d.Code)
			return s.lastErr
		}
		domains[d.Code] = d
		order = append(order, d.Code)
	}

	s.domains = domains
	s.order = order
	s.mtime = info.ModTime()
	s.loaded = true
	s.lastErr = nil
	return nil
}

// ListBusinessDomains 是 GET /api/v2/platform/business-domains 的只读 handler。
// 返回 `{list:[{code,name,description,enabled}], total}`（03_API_Standard §7.2）。
// 热加载失败时保留上次快照继续服务，错误仅记录日志（与 Prometheus 配置热加载一致）。
func ListBusinessDomains(store *BusinessDomainStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		list, err := store.List()
		if err != nil {
			log.Printf("business domains reload failed, serving last snapshot: %v", err)
		}
		response.OK(c, gin.H{
			"list":  list,
			"total": len(list),
		})
	}
}
