import { describe, it, expect } from 'vitest'
import {
  currentTenant,
  networkDomains,
  edgeAgents,
  configDrafts,
  configVersions,
  configDeployments,
  targetsFilesToText,
  computeJointChecksum,
  edgeAgentInstallGuide,
  changeDetectionStatus,
  domainArtifactShape,
  validationLayeringNote,
  TOKEN_MASK,
  type ConfigTargetsFiles,
} from './module-09'

describe('module-09 mocks', () => {
  it('should expose current tenant with multi_site_enabled flag', () => {
    expect(currentTenant).toHaveProperty('id')
    expect(currentTenant).toHaveProperty('multi_site_enabled')
    expect(typeof currentTenant.multi_site_enabled).toBe('boolean')
  })

  it('should include a default management domain', () => {
    const defaultDomain = networkDomains.find((d) => d.id === 'default')
    expect(defaultDomain).toBeDefined()
    expect(defaultDomain?.domain_type).toBe('management')
  })

  it('should fully mask network domain tokens in UI without plaintext fragments (PRD 3.1 Token 管理)', () => {
    // 统一固定脱敏形态：仅圆点符号，不包含任何明文片段（含首尾 6 位与 tk_ 前缀）
    expect(TOKEN_MASK).toMatch(/^•+$/)
    networkDomains.forEach((domain) => {
      // 完整 Token 保留在数据中，仅通过「复制」按钮获取，UI 不展示明文
      expect(domain.token).toMatch(/^tk_/)
      expect(domain.token.length).toBeGreaterThan(TOKEN_MASK.length)
      expect(domain.token).not.toContain(TOKEN_MASK)
    })
  })

  it('should have edge agents matching declared network domains', () => {
    const domainIds = new Set(networkDomains.map((d) => d.id))
    edgeAgents.forEach((agent) => {
      expect(domainIds.has(agent.network_domain_id)).toBe(true)
    })
  })

  it('should have config drafts/versions/deployments aligned with network domains', () => {
    const domainIds = new Set(networkDomains.map((d) => d.id))
    configDrafts.forEach((draft) => expect(domainIds.has(draft.network_domain_id)).toBe(true))
    configVersions.forEach((version) => expect(domainIds.has(version.network_domain_id)).toBe(true))
    configDeployments.forEach((deployment) => expect(domainIds.has(deployment.network_domain_id)).toBe(true))
  })

  it('should record PRD 4.4 metadata on every config draft', () => {
    configDrafts.forEach((draft) => {
      expect(draft.metadata.source_data_version).toBeTruthy()
      expect(draft.metadata.trigger_summary).toBeTruthy()
      expect(draft.metadata.checksum).toMatch(/^[0-9a-f]{64}$/)
      expect(draft.metadata.generator_version).toBeTruthy()
    })
  })

  it('should expose targets_files on every draft/version and reference file_sd skeletons (PRD 4.4/4.5, 3.3)', () => {
    configDrafts.forEach((draft) => {
      expect(draft.targets_files).toBeTruthy()
      expect(Object.keys(draft.targets_files).length).toBeGreaterThan(0)
      // prometheus.yml 为 file_sd 骨架：不内联 static_configs，且按 job 引用 targets/<job>.json
      expect(draft.prometheus_yml).toContain('file_sd_configs')
      expect(draft.prometheus_yml).not.toContain('static_configs')
      for (const job of Object.keys(draft.targets_files)) {
        expect(draft.prometheus_yml).toContain(`'targets/${job}.json'`)
      }
    })
    configVersions.forEach((version) => {
      expect(version.targets_files).toBeTruthy()
    })
  })

  it('should compute joint checksum over prometheus.yml + rules + blackbox + targets content (PRD 3.3.3)', () => {
    configDrafts.forEach((draft) => {
      expect(draft.metadata.checksum).toBe(
        computeJointChecksum(draft.prometheus_yml, draft.rules_yml, draft.blackbox_yml, draft.targets_files)
      )
    })
  })

  it('should let targets-only changes alter the joint checksum without touching prometheus.yml (PRD 3.3 映射语义)', () => {
    const baseline = configVersions.find((v) => v.id === 'cv-gov-001')
    const updated = configVersions.find((v) => v.id === 'cv-gov-002')
    expect(baseline?.prometheus_yml).toBe(updated?.prometheus_yml)
    expect(baseline?.metadata.checksum).not.toBe(updated?.metadata.checksum)
  })

  it('should serialize targets_files per job into targets/<job>.json text (PRD 6.2)', () => {
    const texts = targetsFilesToText(configDrafts[0].targets_files)
    for (const job of Object.keys(configDrafts[0].targets_files)) {
      expect(texts[job]).toBeTruthy()
    }
    // targets 文件为合法 JSON（除校验失败演示文件外）
    const govTexts = targetsFilesToText(configDrafts.find((d) => d.id === 'draft-gov-001')?.targets_files)
    expect(() => JSON.parse(govTexts['node-exporter'])).not.toThrow()
    expect(() => JSON.parse(govTexts['blackbox-http'])).not.toThrow()
  })

  it('should include a draft that fails pre-deploy validation on targets schema (PRD 3.5.1 demo)', () => {
    const failed = configDrafts.find((d) => d.validation_status === 'failed')
    expect(failed).toBeDefined()
    expect(failed?.validation_error).toContain('targets')
    const plcGateway = (failed?.targets_files as ConfigTargetsFiles)['plc-gateway']
    expect(typeof plcGateway).toBe('string')
    // JSON 未闭合：configgen 侧 schema 解析会失败
    expect(() => JSON.parse(plcGateway as string)).toThrow()
  })

  it('should record agent_ip reported by heartbeat on every edge agent (PRD 3.2)', () => {
    edgeAgents.forEach((agent) => {
      expect(agent.agent_ip).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/)
    })
  })

  it('should expose the edge agent offline delivery install guide (PRD 3.9)', () => {
    expect(edgeAgentInstallGuide.steps.length).toBe(2)
    expect(edgeAgentInstallGuide.env_vars.NETWORK_DOMAIN_ID).toBeTruthy()
    expect(edgeAgentInstallGuide.env_vars.TOKEN).toBeTruthy()
    expect(edgeAgentInstallGuide.checksum_algorithm).toBe('sha256')
    expect(edgeAgentInstallGuide.delivery).toContain('systemd')
    expect(edgeAgentInstallGuide.systemd_unit).toContain('.service')
  })

  it('should describe edge node component composition (边缘节点组件构成, v1.6)', () => {
    // 边缘节点 = Edge Sync Agent（必装）+ 采集器（vmagent/prometheus-agent，由网域 agent_type 登记）+ blackbox exporter（可选）
    const components = edgeAgentInstallGuide.components
    expect(components.length).toBe(3)
    const syncAgent = components.find((c) => c.name.includes('Edge Sync Agent'))
    expect(syncAgent).toBeDefined()
    expect(syncAgent?.required).toBe(true)
    // Edge Sync Agent 非中心平台内置：负责心跳 / 配置拉取 / 控制采集器
    expect(syncAgent?.role).toContain('非中心平台内置')
    expect(syncAgent?.role).toContain('心跳')
    expect(syncAgent?.role).toContain('配置拉取')
    expect(syncAgent?.role).toContain('reload')
    // 采集器由网域 agent_type 登记（vmagent / prometheus-agent 二选一）
    const collector = components.find((c) => c.name.includes('采集器'))
    expect(collector).toBeDefined()
    expect(collector?.name).toContain('vmagent')
    expect(collector?.name).toContain('prometheus-agent')
    expect(collector?.required).toBe(true)
    expect(collector?.role).toContain('agent_type')
    // blackbox exporter 可选，blackbox job 时附带
    const blackbox = components.find((c) => c.name.includes('blackbox'))
    expect(blackbox).toBeDefined()
    expect(blackbox?.required).toBe(false)
    expect(blackbox?.role).toContain('blackbox')
  })

  it('should describe one-step integration install flow (一体化离线包 + Agent 自动部署采集器, v1.8)', () => {
    // ① 安装一体化离线包（Edge Sync Agent + 采集器 vmagent/prometheus-agent 二选一 + blackbox exporter 可选），无需手动分别安装
    expect(edgeAgentInstallGuide.steps[0].title).toContain('一体化离线包')
    expect(edgeAgentInstallGuide.steps[0].description).toContain('systemd')
    expect(edgeAgentInstallGuide.steps[0].description).toContain('NETWORK_DOMAIN_ID')
    expect(edgeAgentInstallGuide.steps[0].description).toContain('TOKEN')
    expect(edgeAgentInstallGuide.steps[0].description).toContain('agent_type')
    expect(edgeAgentInstallGuide.steps[0].description).toContain('vmagent')
    expect(edgeAgentInstallGuide.steps[0].description).toContain('prometheus-agent')
    expect(edgeAgentInstallGuide.steps[0].description).toContain('无需手动分别安装')
    // ② Agent 自动部署采集器（非手动启动：启动顺序 blackbox → 采集器，异常自动重启并上报健康状态）
    expect(edgeAgentInstallGuide.steps[1].title).toContain('自动部署')
    expect(edgeAgentInstallGuide.steps[1].description).toContain('agent_type')
    expect(edgeAgentInstallGuide.steps[1].description).toContain('vmagent')
    expect(edgeAgentInstallGuide.steps[1].description).toContain('prometheus-agent')
    expect(edgeAgentInstallGuide.steps[1].description).toContain('Edge Sync Agent')
    expect(edgeAgentInstallGuide.steps[1].description).toContain('健康状态')
  })

  it('should describe integrated delivery and responsibility boundary (一体化交付 + 职责边界, PRD v1.12)', () => {
    // 一体化交付：离线二进制包为一体化包（Edge Sync Agent + 采集器 vmagent/prometheus-agent 二选一 + blackbox exporter 可选）
    expect(edgeAgentInstallGuide.integration_note).toContain('一体化')
    expect(edgeAgentInstallGuide.integration_note).toContain('vmagent')
    expect(edgeAgentInstallGuide.integration_note).toContain('prometheus-agent')
    // Agent 管理本节点采集器/blackbox 进程（启动守护、健康检查、reload、异常自动重启）
    expect(edgeAgentInstallGuide.integration_note).toContain('本节点')
    expect(edgeAgentInstallGuide.integration_note).toContain('健康检查')
    expect(edgeAgentInstallGuide.integration_note).toContain('启动顺序')
    // 职责边界：只管理本节点组件，不做下游节点 exporter 安装（安全边界，暂不纳入）
    expect(edgeAgentInstallGuide.integration_note).toContain('下游节点')
    expect(edgeAgentInstallGuide.integration_note).toContain('安全边界')
  })

  it('should describe Edge Sync Agent deployment positioning (决策 9)', () => {
    // 独立客户端程序、部署在边缘监控代理节点，非中心平台内置进程
    expect(edgeAgentInstallGuide.deployment).toContain('独立客户端程序')
    expect(edgeAgentInstallGuide.deployment).toContain('中心无入站端口')
    // 与中心通过 outbound HTTPS 443 + 每网域 Token 通信
    expect(edgeAgentInstallGuide.deployment).toContain('outbound HTTPS 443')
    expect(edgeAgentInstallGuide.deployment).toContain('Token')
    // MVP 单网域不部署，v0.2+ 多网域每个边缘节点部署一个（离线二进制包 + systemd）
    expect(edgeAgentInstallGuide.deployment).toContain('MVP 单网域不部署')
    expect(edgeAgentInstallGuide.deployment).toContain('systemd')
  })

  it('should layer config artifact shape by domain type (决策 6 配置产物形态分层)', () => {
    const defaultDomain = networkDomains.find((d) => d.id === 'default')
    expect(defaultDomain?.domain_type).toBe('management')
    // 中心管理域（default）=本地文件集：无 zip / metadata.json 下载校验
    expect(domainArtifactShape(defaultDomain!)).toBe('local_files')
    // 边缘域=zip 配置包（含 metadata.json 供拉取后 checksum 校验）
    networkDomains
      .filter((d) => d.domain_type === 'edge')
      .forEach((d) => {
        expect(domainArtifactShape(d)).toBe('zip_package')
      })
    // 分层依据是域类型而非单/多网域开关：当前 mock 处于多网域模式（multi_site_enabled=true），
    // default 管理域依然走本地文件集
    expect(currentTenant.multi_site_enabled).toBe(true)
    expect(domainArtifactShape(defaultDomain!)).toBe('local_files')
    // 所有网域均可判定配置产物形态（不存在未分层网域）
    networkDomains.forEach((d) => {
      expect(['local_files', 'zip_package']).toContain(domainArtifactShape(d))
    })
  })

  it('should mark deployments with pre-deploy validation result and blackbox participation', () => {
    configDeployments.forEach((deployment) => {
      expect(['passed', 'failed', 'pending']).toContain(deployment.validation_status)
      expect(typeof deployment.includes_blackbox).toBe('boolean')
    })
    const failedValidation = configDeployments.find((d) => d.validation_status === 'failed')
    expect(failedValidation?.error_message).toBeTruthy()
  })

  it('should expose an agent demonstrating config package checksum failure', () => {
    const agent = edgeAgents.find((a) => a.last_error.includes('checksum'))
    expect(agent).toBeDefined()
    expect(agent?.config_sync_status).toBe('out_of_sync')
  })

  it('should describe center/edge validation layering and handoff (PRD 6.4 校验分层说明, v1.9)', () => {
    // 中心①内容校验（生成阶段）：promtool / blackbox --config.check / configgen targets schema，结果以 validation_status 展示，失败阻止确认下发
    expect(validationLayeringNote.center).toContain('promtool check config')
    expect(validationLayeringNote.center).toContain('blackbox_exporter --config.check')
    expect(validationLayeringNote.center).toContain('configgen')
    expect(validationLayeringNote.center).toContain('validation_status')
    expect(validationLayeringNote.center).toContain('阻止确认下发')
    // 边缘②传输校验（Agent 拉包阶段）：metadata.json checksum 完整性 + targets/*.json 解析，结果体现于 config_sync_status
    expect(validationLayeringNote.edge).toContain('metadata.json')
    expect(validationLayeringNote.edge).toContain('checksum')
    expect(validationLayeringNote.edge).toContain('targets/*.json')
    expect(validationLayeringNote.edge).toContain('config_sync_status')
    // Agent 为「哑校验」：不做 promtool 级语法校验，产物合法性由中心内容校验保证
    expect(validationLayeringNote.agentDumbCheck).toContain('哑校验')
    expect(validationLayeringNote.agentDumbCheck).toContain('不做 promtool 级语法校验')
    // 联合 checksum 双用途：中心草稿去重裁决 + 边缘拉包完整性校验
    expect(validationLayeringNote.checksumDualUse).toContain('草稿去重裁决')
    expect(validationLayeringNote.checksumDualUse).toContain('拉包完整性校验')
  })

  it('should expose collector version and running status per edge agent (PRD 3.2 采集器进程管理 / 6.3 第 1 条)', () => {
    edgeAgents.forEach((agent) => {
      // 采集器版本与运行状态纳入 Agent 状态展示（对应表格「采集器版本 / 采集器状态」列）
      expect(agent.collector_version).toBeTruthy()
      expect(['running', 'stopped', 'unknown']).toContain(agent.collector_status)
      // 采集器版本与 agent_type 语义一致：vmagent / prometheus-agent
      if (agent.agent_type === 'vmagent') {
        expect(agent.collector_version).toMatch(/^v1\./)
      } else {
        expect(agent.collector_version).toMatch(/^v2\./)
      }
    })
    // 三种采集器运行状态均有演示（running / stopped / unknown）
    const statuses = new Set(edgeAgents.map((a) => a.collector_status))
    expect(statuses.has('running')).toBe(true)
    expect(statuses.has('stopped')).toBe(true)
    expect(statuses.has('unknown')).toBe(true)
    // version 保留为 Edge Sync Agent 版本（EdgeAgent = Edge Sync Agent + 采集器组合，PRD 4.2）
    edgeAgents.forEach((agent) => {
      expect(agent.version).toBeTruthy()
    })
  })

  it('should map every draft to a network domain name (所属网域列, PRD 3.4)', () => {
    const domainNameMap = Object.fromEntries(networkDomains.map((d) => [d.id, d.name]))
    configDrafts.forEach((draft) => {
      expect(domainNameMap[draft.network_domain_id]).toBeTruthy()
    })
  })

  it('should demonstrate pending-only default view distribution across domains (默认仅展示待确认草稿, PRD 3.4)', () => {
    // default 域：confirmed + discarded（自动丢弃演示），无 pending → 默认视图为空态
    const defaultDrafts = configDrafts.filter((d) => d.network_domain_id === 'default')
    expect(defaultDrafts.some((d) => d.status === 'confirmed')).toBe(true)
    expect(defaultDrafts.some((d) => d.status === 'discarded')).toBe(true)
    expect(defaultDrafts.some((d) => d.status === 'pending')).toBe(false)
    // gov / mfg 域有 pending 草稿 → 默认视图有内容
    expect(configDrafts.some((d) => d.network_domain_id === 'gov-cloud-a' && d.status === 'pending')).toBe(true)
    expect(
      configDrafts.some((d) => d.network_domain_id === 'manufacturing-edge' && d.status === 'pending')
    ).toBe(true)
    // finance 域仅 discarded → 默认视图为空态，历史视图有内容
    expect(configDrafts.some((d) => d.network_domain_id === 'finance-dmz' && d.status === 'pending')).toBe(false)
    expect(configDrafts.some((d) => d.network_domain_id === 'finance-dmz' && d.status === 'discarded')).toBe(true)
  })

  it('should include an auto-discarded draft on checksum match (PRD 3.3.3 自动丢弃演示)', () => {
    const autoDiscarded = configDrafts.find((d) => d.id === 'draft-default-002')
    expect(autoDiscarded).toBeDefined()
    expect(autoDiscarded?.status).toBe('discarded')
    expect(autoDiscarded?.metadata.reason).toContain('checksum')
    // 联合 checksum 与生效版本 cv-default-001 一致 → 内容无变化自动丢弃，不进入确认列表
    const effective = configVersions.find((v) => v.id === 'cv-default-001')
    expect(autoDiscarded?.metadata.checksum).toBe(effective?.metadata.checksum)
  })

  it('should expose per-domain change detection status with all three outcomes (PRD 3.3.3 检测状态可观测)', () => {
    const domainIds = new Set(networkDomains.map((d) => d.id))
    const outcomes = new Set(changeDetectionStatus.map((s) => s.outcome))
    changeDetectionStatus.forEach((status) => {
      expect(domainIds.has(status.network_domain_id)).toBe(true)
      expect(status.last_checked_at).toBeTruthy()
      expect(status.source_data_version).toBeTruthy()
      expect(['changes_found', 'no_change', 'checksum_same']).toContain(status.outcome)
      expect(status.summary).toBeTruthy()
      // changes_found 引用的生成草稿必须真实存在
      status.generated_drafts.forEach((draft) => {
        expect(configDrafts.some((d) => d.id === draft.id)).toBe(true)
      })
    })
    // 三种检测结果均有演示：检测到变更 / 无变更跳过重算 / checksum 一致自动丢弃
    expect(outcomes.has('changes_found')).toBe(true)
    expect(outcomes.has('no_change')).toBe(true)
    expect(outcomes.has('checksum_same')).toBe(true)
    // checksum_same 检测状态与自动丢弃草稿（draft-default-002）联动
    const checksumSame = changeDetectionStatus.find((s) => s.outcome === 'checksum_same')
    expect(checksumSame?.network_domain_id).toBe('default')
    expect(configDrafts.find((d) => d.id === 'draft-default-002')).toBeDefined()
  })
})
