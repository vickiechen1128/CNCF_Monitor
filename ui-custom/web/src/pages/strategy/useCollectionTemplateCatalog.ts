/**
 * 采集模板目录 / 选择器字段字典的共享加载器（SRS Module_01 v1.5）。
 *
 * 模板与字段字典都可能被多个页面同时使用；这里做进程内缓存，避免同一屏
 * 多个组件各发一次请求。
 */
import { useCallback, useEffect, useState } from 'react'
import { candidateFieldApi, collectionTemplateApi } from '../../api/collectionTemplates'
import type { CandidateField, CollectionTemplate } from '../../types/collectionTemplate'

let templateCache: CollectionTemplate[] | null = null
let fieldCache: CandidateField[] | null = null

export interface CollectionTemplateCatalog {
  templates: CollectionTemplate[]
  loading: boolean
  error?: string
  reload: () => void
}

/** 加载全部采集模板（含停用），按类别+排序返回。 */
export function useCollectionTemplateCatalog(): CollectionTemplateCatalog {
  const [templates, setTemplates] = useState<CollectionTemplate[]>(templateCache ?? [])
  const [loading, setLoading] = useState(!templateCache)
  const [error, setError] = useState<string>()

  const load = useCallback(() => {
    setLoading(true)
    collectionTemplateApi
      .list({ page_size: 100 })
      .then((res) => {
        templateCache = res.data.list ?? []
        setTemplates(templateCache)
        setError(undefined)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    // 首次挂载即拉取目录；load 内部的 setState 是必要的加载态切换。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!templateCache) load()
  }, [load])

  const reload = useCallback(() => {
    templateCache = null
    load()
  }, [load])

  return { templates, loading, error, reload }
}

export interface CandidateFieldCatalog {
  fields: CandidateField[]
  loading: boolean
  error?: string
  reload: () => void
}

/** 加载选择器字段字典（内置字段 + M07 自定义字段）。 */
export function useCandidateFields(): CandidateFieldCatalog {
  const [fields, setFields] = useState<CandidateField[]>(fieldCache ?? [])
  const [loading, setLoading] = useState(!fieldCache)
  const [error, setError] = useState<string>()

  const load = useCallback(() => {
    setLoading(true)
    candidateFieldApi
      .list()
      .then((res) => {
        fieldCache = res.data.list ?? []
        setFields(fieldCache)
        setError(undefined)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!fieldCache) load()
  }, [load])

  const reload = useCallback(() => {
    fieldCache = null
    load()
  }, [load])

  return { fields, loading, error, reload }
}

/** 清空进程内缓存（测试用）。 */
export function resetCollectionCatalogCache(): void {
  templateCache = null
  fieldCache = null
}
