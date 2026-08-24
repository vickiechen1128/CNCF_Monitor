/**
 * 规则文件（rules.yml）轻量 YAML 结构预检工具（F6）。
 * 仅校验顶层存在 `groups` 数组，满足挂载前置；PromQL 语义校验由 v0.3（M02）承担。
 */
export function validateYamlClient(content: string): { valid: boolean; error?: string } {
  if (!content || !content.trim()) {
    return { valid: false, error: '规则文件内容不能为空' }
  }
  if (!/^\s*groups\s*:/m.test(content)) {
    return { valid: false, error: 'rules.yml 缺少顶层 groups 数组' }
  }
  return { valid: true }
}