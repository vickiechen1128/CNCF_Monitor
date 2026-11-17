/**
 * 抑制规则 API（v3）。页面沿用「整表保存」交互，v3 后端提供单条 CRUD，
 * 因此这里在客户端做 diff：新增 POST、修改 PUT、删除 DELETE，逐条落库后
 * 返回最后一次保存结果（供页面提示）。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type {
  InhibitionListData,
  InhibitionRule,
  SaveInhibitionsPayload,
  SaveRoutesResult,
} from '../types/alertmanager'

const BASE = '/api/v3/platform/alertmanager/inhibitions'

interface WireMatcher {
  name: string
  value: string
  is_regex: boolean
  is_equal?: boolean
}

interface WireInhibition {
  id: string
  name: string
  source_matchers: WireMatcher[] | null
  target_matchers: WireMatcher[] | null
  equal: string[] | null
  enabled: boolean
  builtin: boolean
}

interface WireSaveResult {
  config_checksum: string
  config_version: string
  pending_sections: string[]
  reload?: { status: string; duration_ms: number; at?: string } | null
  snapshot_synced: boolean
}

function toRule(rule: WireInhibition): InhibitionRule {
  const map = (list: WireMatcher[] | null) =>
    (list ?? []).map((matcher) => ({
      name: matcher.name,
      value: matcher.value,
      is_regex: matcher.is_regex,
      is_equal: matcher.is_equal !== false,
    }))
  return {
    id: rule.id,
    name: rule.name,
    source_matchers: map(rule.source_matchers),
    target_matchers: map(rule.target_matchers),
    equal: rule.equal ?? [],
    enabled: rule.enabled,
  }
}

function toBody(rule: InhibitionRule) {
  const map = (list: InhibitionRule['source_matchers']) =>
    (list ?? []).map((matcher) => ({
      name: matcher.name,
      value: matcher.value,
      is_regex: matcher.is_regex === true,
      is_equal: matcher.is_equal !== false,
    }))
  return {
    name: rule.name,
    source_matchers: map(rule.source_matchers),
    target_matchers: map(rule.target_matchers),
    equal: rule.equal ?? [],
    enabled: rule.enabled,
  }
}

function signature(rule: InhibitionRule | WireInhibition): string {
  const equal = (rule as InhibitionRule).equal ?? []
  return JSON.stringify({
    name: rule.name,
    source: rule.source_matchers ?? [],
    target: rule.target_matchers ?? [],
    equal,
    enabled: rule.enabled,
  })
}

function lastSaveResult(res: ApiResponse<{ save?: WireSaveResult }>): SaveRoutesResult {
  const save = res.data?.save
  return {
    version: {
      id: '',
      content: '',
      checksum: save?.config_checksum ?? '',
      status: 'applied',
      created_at: save?.reload?.at,
      applied_at: save?.reload?.at,
    },
    applied: save?.reload?.status === 'succeeded',
    reload_status: save?.reload?.status,
    pending_sections: save?.pending_sections ?? [],
    snapshot_synced: save?.snapshot_synced ?? false,
  }
}

export const inhibitionsApi = {
  async list(): Promise<ApiResponse<InhibitionListData>> {
    const res = await apiClient.get<{ list: WireInhibition[]; total: number }>(`${BASE}?page_size=100`)
    return {
      ...res,
      data: {
        items: (res.data.list ?? []).map(toRule),
        // v3 每条规则独立保存；列表不再携带配置 checksum，页面保存时传空即可。
        effective_checksum: '',
      },
    }
  },
  /**
   * 整表保存：把草稿与服务端现状做 diff 后逐条提交。
   * 返回最后一次保存的 apply 结果；没有任何变更时返回一个空成功结果。
   */
  async save(payload: SaveInhibitionsPayload): Promise<ApiResponse<SaveRoutesResult>> {
    const current = await apiClient.get<{ list: WireInhibition[]; total: number }>(`${BASE}?page_size=100`)
    const server = new Map((current.data.list ?? []).map((rule) => [rule.id, rule]))
    const draft = payload.inhibit_rules ?? []
    let lastResult: SaveRoutesResult = {
      version: { id: '', content: '', checksum: '', status: 'applied' },
    }

    for (const rule of draft) {
      const isNew = !rule.id || rule.id.startsWith('inhibit-new-')
      if (isNew) {
        const created = await apiClient.post<{ rule: WireInhibition; save: WireSaveResult }>(BASE, {
          body: toBody(rule),
        })
        lastResult = lastSaveResult(created)
        continue
      }
      const existing = server.get(rule.id)
      if (!existing) continue
      if (signature(existing) !== signature(rule)) {
        const updated = await apiClient.put<{ rule: WireInhibition; save: WireSaveResult }>(
          `${BASE}/${encodeURIComponent(rule.id)}`,
          { body: toBody(rule) },
        )
        lastResult = lastSaveResult(updated)
      }
    }

    const draftIDs = new Set(draft.map((rule) => rule.id))
    for (const serverRule of current.data.list ?? []) {
      if (draftIDs.has(serverRule.id)) continue
      if (serverRule.builtin) continue // 预置规则不可删
      const deleted = await apiClient.delete<{ deleted: boolean; save: WireSaveResult }>(
        `${BASE}/${encodeURIComponent(serverRule.id)}`,
      )
      lastResult = lastSaveResult(deleted)
    }

    return { status: 'success', data: lastResult }
  },
}
