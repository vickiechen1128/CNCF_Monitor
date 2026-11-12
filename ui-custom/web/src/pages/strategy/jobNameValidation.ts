/**
 * Job 名称校验（与后端 models.ValidateJobName 同口径）。
 *
 * targets 文件名直接使用 `<job_name>.json`，因此 job_name 只受「能否原样作为文件名」
 * 约束：中文、字母、数字及 _ - . 均允许；空白、路径分隔符与 Windows 文件名非法字符
 * 会破坏落盘路径，必须在保存入口拦截。
 */
const JOB_NAME_FORBIDDEN = /[\s/\\:*?"<>|]/

/** 控制字符（U+0000–U+001F、U+007F）会破坏文件名/YAML，单独判定避免 no-control-regex。 */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** Ant Design Form 校验器：invalid 时 reject，合法时 resolve。 */
export function validateJobName(_rule: unknown, value?: string): Promise<void> {
  const name = value ?? ''
  if (name === '') {
    return Promise.reject(new Error('请输入 Job 名称'))
  }
  if (name === '.' || name === '..' || name.endsWith('.')) {
    return Promise.reject(new Error('Job 名称不能为 . / .. 或以 . 结尾'))
  }
  if (JOB_NAME_FORBIDDEN.test(name) || hasControlChar(name)) {
    return Promise.reject(new Error('Job 名称不能包含空白、控制字符或 / \\ : * ? " < > |'))
  }
  return Promise.resolve()
}
