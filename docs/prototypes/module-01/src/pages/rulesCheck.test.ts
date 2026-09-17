import { describe, it, expect } from 'vitest'
import {
  checkRuleContent,
  collectJobRefIssues,
  effectiveJobNames,
  parseGroupNames,
  validateRuleContent,
} from './rulesCheck'
import { mockMountedRuleFiles } from '../mocks/module-01'

/** {v3.41} 决策 69-1 / 66 / 67-2：规则挂载「检查」预检口径（原型本地等价模拟后端 `validate-yaml`） */
const yaml = (group: string, expr: string): string => `groups:
  - name: ${group}
    rules:
      - alert: DemoAlert
        expr: ${expr}
`

describe('M01 规则挂载检查：硬失败（决策 69-1）', () => {
  it('YAML 结构非法（空内容 / 缺 groups）→ valid=false', () => {
    expect(validateRuleContent('').ok).toBe(false)
    expect(validateRuleContent('foo: bar').ok).toBe(false)
  })

  it('parseGroupNames 提取全部组名（含引号剥离）', () => {
    expect(parseGroupNames(yaml('node.rules', 'up == 0'))).toEqual(['node.rules'])
    expect(parseGroupNames(yaml('"quoted.rules"', 'up == 0'))).toEqual(['quoted.rules'])
  })

  it('同文件内组名重复 → valid=false 且提示「组名重复」', () => {
    const content = `groups:
  - name: dup.rules
    rules:
      - alert: A
        expr: up == 0
  - name: dup.rules
    rules:
      - alert: B
        expr: up == 0
`
    const outcome = checkRuleContent(content, mockMountedRuleFiles)
    expect(outcome.valid).toBe(false)
    expect(outcome.error).toContain('组名重复')
  })

  it('与「生效」规则文件组名冲突 → valid=false 且点明占用方（node.rules 在 rule-file-001）', () => {
    const outcome = checkRuleContent(yaml('node.rules', 'up == 0'), mockMountedRuleFiles)
    expect(outcome.valid).toBe(false)
    expect(outcome.error).toContain('组名冲突')
    expect(outcome.error).toContain('主机与中间件告警')
  })

  it('镜像提交侧：撞名「停用」文件的组名不校验（blackbox.rules 在 rule-file-003 且 enabled=false）→ valid=true', () => {
    const outcome = checkRuleContent(yaml('blackbox.rules', 'probe_success == 0'), mockMountedRuleFiles)
    expect(outcome.valid).toBe(true)
    expect(outcome.error).toBeUndefined()
  })

  it('全新组名 → valid=true', () => {
    const outcome = checkRuleContent(yaml('brand-new.rules', 'up == 0'), mockMountedRuleFiles)
    expect(outcome.valid).toBe(true)
  })
})

describe('M01 规则挂载检查：job 引用分级（决策 66 / 67-2，可经逃生门覆盖）', () => {
  it('存活类规则（up）引用不存在的 Job → severity=error', () => {
    const issues = collectJobRefIssues(yaml('d.rules', 'up{job="no-such-job"} == 0'), effectiveJobNames())
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ referencedJob: 'no-such-job', severity: 'error' })
  })

  it('absent(up) 同样按存活类判为 error', () => {
    const issues = collectJobRefIssues(
      yaml('d.rules', 'absent(up{job=~"node|linux"})'),
      effectiveJobNames()
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('error')
  })

  it('非存活类规则引用不存在的 Job → severity=warning（不阻断）', () => {
    const issues = collectJobRefIssues(
      yaml('d.rules', 'redis_memory_used_bytes{job="prod-mysql"} > 0'),
      effectiveJobNames()
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('warning')
  })

  it('引用「生效」Job → 无问题（blackbox-http-default）', () => {
    const issues = collectJobRefIssues(
      yaml('d.rules', 'probe_success{job="blackbox-http-default"} == 0'),
      effectiveJobNames()
    )
    expect(issues).toHaveLength(0)
  })

  it('job=~ 正则：任一候选命中即通过，全不命中才记问题', () => {
    expect(
      collectJobRefIssues(yaml('d.rules', 'up{job=~"prod-redis|prod-nginx"} == 0'), effectiveJobNames())
    ).toHaveLength(0)
    const miss = collectJobRefIssues(yaml('d.rules', 'up{job=~"nope-a|nope-b"} == 0'), effectiveJobNames())
    expect(miss).toHaveLength(1)
    expect(miss[0].severity).toBe('error')
  })

  it('生效 Job 名单排除 disabled 与 draft（prod-mysql / staging-apps 不在名单）', () => {
    const jobs = effectiveJobNames()
    expect(jobs).toContain('prod-redis')
    expect(jobs).not.toContain('prod-mysql')
    expect(jobs).not.toContain('staging-apps')
  })

  it('job 引用问题不改写 valid（仍为可提交，只是默认阻断由前端按钮状态承担）', () => {
    const outcome = checkRuleContent(yaml('ok.rules', 'up{job="no-such-job"} == 0'), mockMountedRuleFiles)
    expect(outcome.valid).toBe(true)
    expect(outcome.jobRef.some((i) => i.severity === 'error')).toBe(true)
  })
})
