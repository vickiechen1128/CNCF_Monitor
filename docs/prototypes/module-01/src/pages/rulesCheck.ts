import { mockScrapeJobs } from '../mocks/module-01'

/**
 * {v3.41} 规则挂载「检查」判定逻辑（决策 69-1 / 66 / 67-2）。
 *
 * 从 RulesPage.tsx 抽出为独立模块的原因：① 便于单测（页面组件只导出组件，满足 react-refresh 规范）；
 * ② 明确「本地等价模拟」边界——生产实现为后端 `POST /api/v2/platform/monitoring-rules/:id/validate-yaml`。
 */

/** {v3.24} 规则文件挂载 YAML 校验（PRD 5.5 / 6.2.4）：至少校验 groups 存在且为数组（原型本地兜底，生产由 `validate-yaml` 承担） */
export const validateRuleContent = (
  content: string
): { ok: true } | { ok: false; message: string } => {
  if (!content.trim()) return { ok: false, message: '规则文件内容不能为空' }
  if (!/^groups\s*:/m.test(content)) {
    return { ok: false, message: 'YAML 非法：缺少顶层键 groups（rules.yml 必须以 groups 为顶层数组）' }
  }
  const groupNames = content.match(/^\s*-\s*name\s*:/gm)
  if (!groupNames || groupNames.length === 0) {
    return { ok: false, message: 'YAML 非法：groups 下缺少规则分组（需至少一个 - name: xxx）' }
  }
  if (!/^(\s*)rules\s*:/m.test(content)) {
    return { ok: false, message: 'YAML 非法：缺少 rules 键（每个分组下需有 rules 数组）' }
  }
  return { ok: true }
}

/** {v3.41} 决策 69-1：解析规则文件内的分组名（组名全局唯一性预检用） */
export const parseGroupNames = (content: string): string[] =>
  (content.match(/^\s*-\s*name\s*:\s*(.+)$/gm) ?? []).map((line) =>
    line
      .replace(/^\s*-\s*name\s*:\s*/, '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
  )

/** {v3.41} 决策 66 / 67-2：job matcher 引用问题（原型本地等价模拟后端 `job_ref` 判定） */
export type RuleJobRefIssue = {
  ruleName: string
  matcher: string
  referencedJob: string
  severity: 'error' | 'warning'
}

/** {v3.41} 解析 `job="..."` / `job=~"..."` 并与当前生效 Job 名单比对：存活类（up / absent(up)）缺 job = error，其余 = warning */
export const collectJobRefIssues = (content: string, effectiveJobs: string[]): RuleJobRefIssue[] => {
  const issues: RuleJobRefIssue[] = []
  let ruleName = ''
  for (const line of content.split(/\r?\n/)) {
    const ruleMatch = line.match(/^\s*-\s*(?:alert|record)\s*:\s*(.+)$/)
    if (ruleMatch) {
      ruleName = ruleMatch[1].trim().replace(/^['"]|['"]$/g, '')
      continue
    }
    const exprMatch = line.match(/^\s*expr\s*:\s*(.+)$/)
    if (!exprMatch) continue
    const expr = exprMatch[1]
    // 存活类判定：表达式含独立词 up（含 absent(up)）——缺 job 会造成告警恒触发，故为 error
    const isLiveness = /\bup\b/.test(expr)
    const matcherRe = /job\s*(=~|=)\s*"([^"]*)"/g
    let m: RegExpExecArray | null
    while ((m = matcherRe.exec(expr)) !== null) {
      const op = m[1]
      const value = m[2]
      const candidates = op === '=~' ? value.split('|').filter(Boolean) : [value]
      if (candidates.some((c) => effectiveJobs.includes(c))) continue
      issues.push({
        ruleName: ruleName || '（未命名规则）',
        matcher: `job${op}"${value}"`,
        referencedJob: value,
        severity: isLiveness ? 'error' : 'warning',
      })
    }
  }
  return issues
}

/** {v3.41} 检查结论：`valid=false` = 不可覆盖硬失败；`jobRef` = 可经逃生门覆盖的独立轴（决策 69-1） */
export type RuleCheckOutcome = { valid: boolean; error?: string; jobRef: RuleJobRefIssue[] }

/** 与提交侧同口径的「生效 Job」名单（决策 69-1：仅生效对象参与判定） */
export const effectiveJobNames = (): string[] =>
  mockScrapeJobs.filter((j) => j.enabled && j.draft_status !== 'draft').map((j) => j.job_name)

/**
 * {v3.41} 决策 69-1 / 69-2：检查 = **预检是否可提交**。
 * 真实实现为调用 `POST /api/v2/platform/monitoring-rules/:id/validate-yaml`；
 * 原型以本地等价逻辑模拟——硬失败（YAML 结构 / 组名全局唯一性）折叠进 `valid=false`，
 * job 引用分级（error 可经逃生门覆盖）为独立轴、不改写 `valid`。
 */
export const checkRuleContent = (
  content: string,
  existingFiles: { name: string; enabled: boolean; rule_content: string }[]
): RuleCheckOutcome => {
  const structural = validateRuleContent(content)
  if (!structural.ok) return { valid: false, error: structural.message, jobRef: [] }

  const names = parseGroupNames(content)
  const duplicated = names.find((n, i) => names.indexOf(n) !== i)
  if (duplicated) {
    return {
      valid: false,
      error: `组名重复：「${duplicated}」在同一规则文件内出现多次。组名须全局唯一，同名多组请写在同一条规则内容内。`,
      jobRef: [],
    }
  }
  // 镜像提交侧口径：仅「生效」的规则文件参与组名唯一性校验；停用文件不校验（决策 69-1）
  const occupied = new Map<string, string>()
  existingFiles
    .filter((f) => f.enabled)
    .forEach((f) => {
      parseGroupNames(f.rule_content).forEach((n) => occupied.set(n, f.name))
    })
  const conflict = names.find((n) => occupied.has(n))
  if (conflict) {
    return {
      valid: false,
      error: `组名冲突：「${conflict}」已被生效规则文件「${occupied.get(conflict)}」占用。组名须全局唯一，请改名或并入同一条规则内容。`,
      jobRef: [],
    }
  }
  return { valid: true, jobRef: collectJobRefIssues(content, effectiveJobNames()) }
}
