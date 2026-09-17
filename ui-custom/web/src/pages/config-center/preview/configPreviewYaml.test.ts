import { describe, it, expect } from 'vitest'
import {
  affectedFileSet,
  computeDiff,
  fileTextByKey,
  PREVIEW_TABS,
  previewFileText,
  previewTabsFor,
  shortChecksum,
  targetsText,
} from './configPreviewYaml'
import type { ConfigDraft, ConfigVersion } from '../../../types/config-center'

const base: ConfigDraft = {
  change_no: 'CHG-20260823-001',
  network_domain_id: 'default',
  network_domain_name: '默认域',
  channel: 'local',
  status: 'pending',
  summary: '',
  risk: 'low',
  affected_files: [],
  validation_status: 'passed',
  created_at: '2026-08-23T10:00:00Z',
  source_version: '',
}

describe('configPreviewYaml（配置预览 / Diff 工具）', () => {
  it('affectedFileSet 聚合 change_items 与列表 affected_files', () => {
    const set = affectedFileSet({
      ...base,
      affected_files: ['targets', 'rules'],
      change_items: [
        { id: 'c1', type: 'add', target: 'target_instance', description: '', affected_files: ['prometheus', 'targets'], risk: 'low' },
      ],
    })
    expect(set.has('prometheus')).toBe(true)
    expect(set.has('targets')).toBe(true)
    expect(set.has('rules')).toBe(true)
    expect(set.has('blackbox')).toBe(false)
  })

  it('targetsText 将多个 job 拼接为带注释文本；空映射返回 undefined', () => {
    expect(targetsText({})).toBeUndefined()
    expect(targetsText()).toBeUndefined()
    const text = targetsText({ job_a: 'a', job_b: 'b' })
    expect(text).toContain('# job_a.json')
    expect(text).toContain('# job_b.json')
  })

  it('targetsText 对已含 .json 后缀的 key 不重复追加（修复 default.json.json）', () => {
    const text = targetsText({ 'default.json': 'x' })
    expect(text).toContain('# default.json')
    expect(text).not.toContain('default.json.json')
  })

  it('previewFileText 按产物 key 取文本', () => {
    const draft: ConfigDraft = {
      ...base,
      prometheus_yml: 'global:',
      targets_files: { job: '[...]' },
    }
    expect(previewFileText(draft, 'prometheus.yml')).toBe('global:')
    expect(previewFileText(draft, 'targets')).toContain('# job.json')
    expect(previewFileText(draft, 'blackbox.yml')).toBeUndefined()
  })

  // === 决策 60：alertmanager.yml 纳入配置预览 ===
  it('PREVIEW_TABS 含 alertmanager.yml 条件 Tab（决策 60）', () => {
    const am = PREVIEW_TABS.find((t) => t.key === 'alertmanager.yml')
    expect(am).toBeDefined()
    expect(am?.label).toBe('alertmanager.yml')
    expect(am?.affectedKey).toBe('alertmanager')
  })

  it('previewTabsFor 仅变更单含 alertmanager_yml 时展示 alertmanager.yml Tab（条件渲染）', () => {
    expect(previewTabsFor(base).find((t) => t.key === 'alertmanager.yml')).toBeUndefined()
    const withAm: ConfigDraft = { ...base, alertmanager_yml: 'route:' }
    const tabs = previewTabsFor(withAm)
    expect(tabs.find((t) => t.key === 'alertmanager.yml')).toBeDefined()
    // 不含 AM 时仍保留其余预览 Tab
    expect(previewTabsFor(base).find((t) => t.key === 'prometheus.yml')).toBeDefined()
  })

  it('previewFileText 读取 alertmanager_yml 产物', () => {
    const withAm: ConfigDraft = { ...base, alertmanager_yml: 'route:\n  receiver: web' }
    expect(previewFileText(withAm, 'alertmanager.yml')).toBe('route:\n  receiver: web')
    expect(previewFileText(base, 'alertmanager.yml')).toBeUndefined()
  })

  it('affectedFileSet 聚合含 alertmanager 的受影响文件（决策 60）', () => {
    const set = affectedFileSet({
      ...base,
      affected_files: ['alertmanager'],
      change_items: [
        { id: 'c1', type: 'update', target: 'alertmanager_config', description: '', affected_files: ['alertmanager'], risk: 'low' },
      ],
    })
    expect(set.has('alertmanager')).toBe(true)
  })

  it('fileTextByKey 兼容读取 alertmanager_yml（版本对比 Tab 复用的源）', () => {
    const version: ConfigVersion = {
      id: 'cv-1',
      network_domain_id: 'default',
      alertmanager_yml: 'global:',
    }
    expect(fileTextByKey(version, 'alertmanager.yml')).toBe('global:')
    const draft: ConfigDraft = { ...base, alertmanager_yml: 'route:' }
    expect(fileTextByKey(draft, 'alertmanager.yml')).toBe('route:')
  })

  it('shortChecksum 长校验值短显、空值返回 -', () => {
    expect(shortChecksum()).toBe('-')
    expect(shortChecksum('abc')).toBe('abc')
    expect(shortChecksum('0123456789abcdefghijklmnopqrstuvwxyz')).toContain('…')
  })

  it('computeDiff 区分相同/新增/移除行', () => {
    const rows = computeDiff('a\nb\nc', 'a\nx\nc')
    expect(rows.find((r) => r.type === 'added')?.newLine).toBe('x')
    expect(rows.find((r) => r.type === 'removed')?.oldLine).toBe('b')
    expect(rows.some((r) => r.type === 'same')).toBe(true)
  })

  it('computeDiff 空旧文本（新文件）只标新增，不产生 spurious removed 空首行（MEDIUM-2）', () => {
    const rows = computeDiff(undefined, 'a\nb')
    expect(rows.filter((r) => r.type === 'removed')).toHaveLength(0)
    expect(rows.filter((r) => r.type === 'added')).toHaveLength(2)
    // 旧文本为空串也应视为无行，避免单一 [""] 被误判
    const rowsEmptyString = computeDiff('', 'a')
    expect(rowsEmptyString.filter((r) => r.type === 'removed')).toHaveLength(0)
  })

  it('fileTextByKey 兼容 ConfigDraft 与 ConfigVersion 产物读取（MEDIUM-2 diff 复用的源）', () => {
    const version: ConfigVersion = {
      id: 'cv-1',
      network_domain_id: 'default',
      prometheus_yml: 'global:',
      targets_files: { job: '[...]' },
    }
    expect(fileTextByKey(version, 'prometheus.yml')).toBe('global:')
    expect(fileTextByKey(version, 'targets')).toContain('# job.json')
    expect(fileTextByKey(version, 'rules.yml')).toBeUndefined()
    // 与 previewFileText（草稿侧读取）即 ConfigDraft 共享同一产物形状
    const draft: ConfigDraft = { ...base, rules_yml: 'groups:' }
    expect(fileTextByKey(draft, 'rules.yml')).toBe('groups:')
  })
})