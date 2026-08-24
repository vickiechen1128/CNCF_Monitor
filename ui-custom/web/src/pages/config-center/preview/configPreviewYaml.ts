/**
 * Module_09 配置预览 YAML / Diff 纯逻辑工具（config-center）。
 * 权威契约：docs/05-execution-records/module-09/api-contract-snapshot.md（§4 配置变更确认 / 产物字段）。
 * 仅含纯函数（无 JSX），供 ConfigPreviewPage 预览 / 版本对比 Tab 复用并便于单测。
 */
import type { AffectedFile, ConfigDraft } from '../../../types/config-center'

/** 预览 Tab 顺序（PRD 3.4 多文件预览；metadata.json 为 v0.2 agent_pull 专属，MVP local 不展示） */
export const PREVIEW_TABS: { key: string; label: string; affectedKey: AffectedFile | null }[] = [
  { key: 'prometheus.yml', label: 'prometheus.yml', affectedKey: 'prometheus' },
  { key: 'targets', label: 'targets/*.json', affectedKey: 'targets' },
  { key: 'rules.yml', label: 'rules.yml', affectedKey: 'rules' },
  { key: 'blackbox.yml', label: 'blackbox.yml', affectedKey: 'blackbox' },
]

/** 从 ConfigDraft 派生出「受影响的配置文件」集合（PRD §9.1：受影响文件高亮依据） */
export function affectedFileSet(draft: ConfigDraft): Set<AffectedFile> {
  const set = new Set<AffectedFile>()
  draft.change_items?.forEach((item) => item.affected_files.forEach((f) => set.add(f)))
  draft.affected_files?.forEach((f) => set.add(f))
  return set
}

/** 产物文本读取：prometheus/rules/blackbox 单文件；targets 为 <job>.json 映射的 JSON 序列化 */
export function previewFileText(draft: ConfigDraft, key: string): string | undefined {
  switch (key) {
    case 'prometheus.yml':
      return draft.prometheus_yml
    case 'rules.yml':
      return draft.rules_yml
    case 'blackbox.yml':
      return draft.blackbox_yml
    case 'targets':
      return targetsText(draft.targets_files)
    default:
      return undefined
  }
}

/** 从「可含产物的对象」（ConfigDraft 或 ConfigVersion）按 Tab key 取文本；供版本对比 Tab 复用（MEDIUM-2） */
export interface ArtifactSource {
  prometheus_yml?: string
  rules_yml?: string
  blackbox_yml?: string
  targets_files?: Record<string, string>
}

export function fileTextByKey(src: ArtifactSource, key: string): string | undefined {
  switch (key) {
    case 'prometheus.yml':
      return src.prometheus_yml
    case 'rules.yml':
      return src.rules_yml
    case 'blackbox.yml':
      return src.blackbox_yml
    case 'targets':
      return targetsText(src.targets_files)
    default:
      return undefined
  }
}

/** targets_files 对象 → 单块文本（多个 job 依次拼接，便于预览与 diff） */
export function targetsText(map?: Record<string, string>): string | undefined {
  if (!map || Object.keys(map).length === 0) return undefined
  return Object.entries(map)
    .map(([job, content]) => `# ${job}.json\n${content}`)
    .join('\n\n')
}

/** 联合校验值短显（展示与复制分离，技术信息折叠区用） */
export function shortChecksum(checksum?: string): string {
  if (!checksum) return '-'
  return checksum.length > 16 ? `${checksum.slice(0, 12)}...${checksum.slice(-8)}` : checksum
}

export type DiffRowType = 'same' | 'added' | 'removed' | 'empty'

export interface DiffRow {
  line: number
  oldLine: string | null
  newLine: string | null
  type: DiffRowType
}

/**
 * 极简行级 diff（PRD 3.4 版本对比；按文件 diff 仅针对可 diff 文件）。
 * 按新增/删除行归类，200 行截断防止超长文件卡死渲染。
 */
export function computeDiff(oldText: string | undefined, newText: string | undefined): DiffRow[] {
  // 空文本按无行处理，避免把单元素 [""] 误判成一行「removed」/「added」空首行（MEDIUM-2 spurious）
  const oldLines = oldText ? oldText.split('\n') : []
  const newLines = newText ? newText.split('\n') : []
  const rows: DiffRow[] = []
  let o = 0
  let n = 0
  // 主循环：双指针逐行对齐；差异行按「是否仍出现在后续新行」判断移除/新增
  while (o < oldLines.length && n < newLines.length && rows.length < 200) {
    const oldLine = oldLines[o]
    const newLine = newLines[n]
    if (oldLine === newLine) {
      rows.push({ line: rows.length + 1, oldLine, newLine, type: 'same' })
      o++
      n++
    } else if (!newLines.slice(n).includes(oldLine)) {
      rows.push({ line: rows.length + 1, oldLine, newLine: null, type: 'removed' })
      o++
    } else {
      rows.push({ line: rows.length + 1, oldLine: null, newLine, type: 'added' })
      n++
    }
  }
  // 收尾：剩余旧行为移除、剩余新行为新增（修复原 for 循环 bound=maxLen 漏发尾部行——MEDIUM-2）
  while (o < oldLines.length && rows.length < 200) {
    rows.push({ line: rows.length + 1, oldLine: oldLines[o], newLine: null, type: 'removed' })
    o++
  }
  while (n < newLines.length && rows.length < 200) {
    rows.push({ line: rows.length + 1, oldLine: null, newLine: newLines[n], type: 'added' })
    n++
  }
  return rows
}