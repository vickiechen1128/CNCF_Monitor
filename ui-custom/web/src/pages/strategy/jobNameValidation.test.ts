import { describe, expect, it } from 'vitest'
import { validateJobName } from './jobNameValidation'

describe('validateJobName', () => {
  it('允许中文、字母、数字及 _ - .', async () => {
    for (const name of ['主机监控', '服务监控', 'node-exporter-prod', 'My.Job_01', '123', '.hidden']) {
      await expect(validateJobName(undefined, name)).resolves.toBeUndefined()
    }
  })

  it('拒绝空白、路径分隔符与文件名非法字符', async () => {
    for (const name of ['', ' ', 'my job', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0000b']) {
      await expect(validateJobName(undefined, name)).rejects.toThrow()
    }
  })

  it('拒绝 . / .. 及以 . 结尾的名字', async () => {
    for (const name of ['.', '..', 'abc.']) {
      await expect(validateJobName(undefined, name)).rejects.toThrow()
    }
  })
})
