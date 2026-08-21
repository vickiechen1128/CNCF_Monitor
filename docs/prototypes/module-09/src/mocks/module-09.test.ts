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
  approvalTieringNote,
  rulesGroupDerivationNote,
  gatewayConstraintNote,
  changeStatusEnumDemo,
  authTlsPassthroughNote,
  frozenDomainExclusionNote,
  defaultFallbackRemovalNote,
  deriveRemoteWriteUrl,
  deriveConfigDownloadUrl,
  MVP_AGENT_TYPE,
  TOKEN_MASK,
  type ConfigTargetsFiles,
  type ConfigChangeTarget,
  type AffectedConfigFile,
} from './module-09'

describe('module-09 mocks', () => {
  it('should expose current tenant with multi_site_enabled flag', () => {
    expect(currentTenant).toHaveProperty('id')
    expect(currentTenant).toHaveProperty('multi_site_enabled')
    expect(typeof currentTenant.multi_site_enabled).toBe('boolean')
  })

  it('should include a default management domain with fixed local channel (决策 32/33)', () => {
    const defaultDomain = networkDomains.find((d) => d.id === 'default')
    expect(defaultDomain).toBeDefined()
    expect(defaultDomain?.domain_type).toBe('management')
    // {v1.33} default 固定 channel=local（中心直接采集，不部署 Edge Agent）
    expect(defaultDomain?.channel).toBe('local')
  })

  it('should fully mask network domain tokens in UI without plaintext fragments (PRD 3.1 Token 管理)', () => {
    // 统一固定脱敏形态：仅圆点符号，不包含任何明文片段（含首尾 6 位与 tk_ 前缀）
    expect(TOKEN_MASK).toMatch(/^•+$/)
    networkDomains.forEach((domain) => {
      if (domain.registration_status === 'created') {
        // {v1.29} 行政已创建未纳管的网域不签发 Token（纳管时才自动签发）
        expect(domain.token).toBe('')
        expect(domain.remote_write_url).toBe('')
        return
      }
      if (domain.channel === 'local') {
        // {v1.33} channel=local 网域不生成 Token（PRD 4.1：token 为空且不展示）
        expect(domain.token).toBe('')
        expect(domain.agent_type).toBe('')
        expect(domain.remote_write_url).toBe('')
        expect(domain.status).toBe('')
        return
      }
      // 已纳管 agent_pull 网域：完整 Token 保留在数据中，仅通过「复制」按钮获取，UI 不展示明文
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

  it('should include a draft that fails pre-deploy validation on targets schema (PRD 3.5.1 demo / 决策 39-1 用户配置问题)', () => {
    // {v1.39} 决策 39-1：按 id 定位用户配置问题草稿（draft-gov-003 为平台故障演示，不在此断言内）
    const failed = configDrafts.find((d) => d.id === 'draft-default-003')
    expect(failed).toBeDefined()
    expect(failed?.validation_status).toBe('failed')
    expect(failed?.validation_cause).toBe('user_config')
    expect(failed?.validation_error).toContain('targets')
    // {v1.39} 决策 39-1：行内 Popover 依赖的定位详情（失败文件 + 行号 + 错误信息）
    expect(failed?.validation_details).toBeDefined()
    expect(failed?.validation_details?.[0].file).toBe('targets/plc-gateway.json')
    expect(failed?.validation_details?.[0].line).toBe(4)
    expect(failed?.validation_details?.[0].message).toContain('JSON')
    const plcGateway = (failed?.targets_files as ConfigTargetsFiles)['plc-gateway']
    expect(typeof plcGateway).toBe('string')
    // JSON 未闭合：configgen 侧 schema 解析会失败
    expect(() => JSON.parse(plcGateway as string)).toThrow()
  })

  it('should include a platform fault draft with validation_cause=platform_fault (决策 39-3: 平台技术故障自动重试, 无用户可见重新校验按钮)', () => {
    const platformFault = configDrafts.find((d) => d.id === 'draft-gov-003')
    expect(platformFault).toBeDefined()
    expect(platformFault?.validation_status).toBe('failed')
    expect(platformFault?.validation_cause).toBe('platform_fault')
    expect(platformFault?.validation_details).toBeDefined()
    expect(platformFault?.validation_details?.[0].file).toBe('rules.yml')
    expect(platformFault?.validation_details?.[0].message).toContain('promtool')
    // 平台故障不展示「重新校验」按钮——用户修不了平台侧 bug，由校验层自动重试（决策 39-3）
    // 持续失败时仅提示「联系平台侧 / 查看日志」
    expect(platformFault?.validation_error).toContain('平台技术故障')
    expect(platformFault?.validation_error).toContain('自动重试')
  })

  it('should record agent_ip reported by heartbeat on every edge agent (PRD 3.2)', () => {
    edgeAgents.forEach((agent) => {
      expect(agent.agent_ip).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/)
    })
  })

  it('should expose the edge agent offline delivery install guide (PRD 3.9)', () => {
    expect(edgeAgentInstallGuide.steps.length).toBe(3)
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

  it('should describe 3 manual install steps with auto deployment merged into step 3 (决策 11 安装指引 3 步人工步骤)', () => {
    // ① 下载并校验一体化离线包（含 Agent + 采集器 + blackbox exporter 可选）
    expect(edgeAgentInstallGuide.steps[0].title).toContain('下载')
    expect(edgeAgentInstallGuide.steps[0].title).toContain('校验')
    expect(edgeAgentInstallGuide.steps[0].description).toContain('一体化离线包')
    expect(edgeAgentInstallGuide.steps[0].description).toContain('sha256')
    expect(edgeAgentInstallGuide.steps[0].description).toContain('vmagent')
    // ② 配置 NETWORK_DOMAIN_ID / TOKEN 环境变量
    expect(edgeAgentInstallGuide.steps[1].title).toContain('NETWORK_DOMAIN_ID')
    expect(edgeAgentInstallGuide.steps[1].title).toContain('TOKEN')
    expect(edgeAgentInstallGuide.steps[1].description).toContain('NETWORK_DOMAIN_ID')
    expect(edgeAgentInstallGuide.steps[1].description).toContain('TOKEN')
    // ③ 启动 Edge Sync Agent（systemd）；采集器与 blackbox 自动部署并入第③步描述，不单列为人工步骤
    expect(edgeAgentInstallGuide.steps[2].title).toContain('启动')
    expect(edgeAgentInstallGuide.steps[2].title).toContain('systemd')
    expect(edgeAgentInstallGuide.steps[2].description).toContain('自动部署')
    expect(edgeAgentInstallGuide.steps[2].description).toContain('启动顺序')
    expect(edgeAgentInstallGuide.steps[2].description).toContain('无需手动安装')
    // 采集器/blackbox 自动部署不再单列为独立步骤（避免「需手动分步装采集器」误解）
    expect(edgeAgentInstallGuide.steps.some((s) => s.title.includes('自动部署采集器'))).toBe(false)
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
    // default 域固定 local 通道（中心直接采集）不部署；agent_pull 通道网域每个边缘节点部署一个（离线二进制包 + systemd）
    expect(edgeAgentInstallGuide.deployment).toContain('local 通道')
    expect(edgeAgentInstallGuide.deployment).toContain('不部署')
    expect(edgeAgentInstallGuide.deployment).toContain('agent_pull 通道网域')
    expect(edgeAgentInstallGuide.deployment).toContain('systemd')
  })

  it('should layer config artifact shape by channel (决策 6 / 决策 32：local=本地文件集，agent_pull=zip 配置包)', () => {
    const defaultDomain = networkDomains.find((d) => d.id === 'default')
    expect(defaultDomain?.domain_type).toBe('management')
    expect(defaultDomain?.channel).toBe('local')
    // local 通道（default）=本地文件集：无 zip / metadata.json 下载校验
    expect(domainArtifactShape(defaultDomain!)).toBe('local_files')
    // agent_pull 通道=zip 配置包（含 metadata.json 供拉取后 checksum 校验）
    networkDomains
      .filter((d) => d.channel === 'agent_pull')
      .forEach((d) => {
        expect(domainArtifactShape(d)).toBe('zip_package')
      })
    // 分层依据是下发通道而非域类型 / 单多网域开关：当前 mock 处于多网域能力开启态，
    // default（channel=local）依然走本地文件集
    expect(currentTenant.multi_site_enabled).toBe(true)
    expect(domainArtifactShape(defaultDomain!)).toBe('local_files')
    // 所有网域均可判定配置产物形态（不存在未分层网域）
    networkDomains.forEach((d) => {
      expect(['local_files', 'zip_package']).toContain(domainArtifactShape(d))
    })
  })

  it('should mark deployments with pre-deploy validation result and blackbox participation (决策 39-2: 校验失败不下发、不产生下发记录)', () => {
    configDeployments.forEach((deployment) => {
      // 下发记录中的 validation_status 为确认时已通过的校验记录（决策 39-2：校验失败不产生下发记录）
      expect(['passed', 'failed', 'pending']).toContain(deployment.validation_status)
      expect(typeof deployment.includes_blackbox).toBe('boolean')
      // 决策 39-2：下发记录中不应存在 validation_status=failed 的记录（校验失败不进入下发流程）
      expect(deployment.validation_status).not.toBe('failed')
    })
  })

  it('should expose an agent demonstrating config package checksum failure', () => {
    const agent = edgeAgents.find((a) => a.last_error.includes('checksum'))
    expect(agent).toBeDefined()
    expect(agent?.config_sync_status).toBe('out_of_sync')
    // {v1.40 决策 40-1}：checksum 校验失败保留旧配置 → 成因 C local_reset（引导「立即同步」）
    expect(agent?.out_of_sync_cause).toBe('local_reset')
  })

  it('should simulate all three out_of_sync causes with cause-based guidance (决策 40-1)', () => {
    // 成因 A（pending_draft）：中心存在待确认变更草稿 →「前往配置确认」
    const pendingDraft = edgeAgents.find((a) => a.out_of_sync_cause === 'pending_draft')
    expect(pendingDraft).toBeDefined()
    expect(pendingDraft?.config_sync_status).toBe('out_of_sync')
    // 成因 B（pull_pending）：无待确认变更、Agent 拉包/生效延迟 → 纯展示等待 +「查看下发记录」
    const pullPending = edgeAgents.find((a) => a.out_of_sync_cause === 'pull_pending')
    expect(pullPending).toBeDefined()
    expect(pullPending?.config_sync_status).toBe('out_of_sync')
    // 成因 C（local_reset）：本地环境/地址变化、checksum 失败留旧包 →「立即同步」
    const localReset = edgeAgents.find((a) => a.out_of_sync_cause === 'local_reset')
    expect(localReset).toBeDefined()
    expect(localReset?.config_sync_status).toBe('out_of_sync')
    // 仅 out_of_sync 状态携带成因，其余状态无 out_of_sync_cause
    edgeAgents.forEach((a) => {
      if (a.config_sync_status === 'out_of_sync') {
        expect(['pending_draft', 'pull_pending', 'local_reset']).toContain(a.out_of_sync_cause)
      } else {
        expect(a.out_of_sync_cause).toBeUndefined()
      }
    })
  })

  it('should keep agent_pull deployments as center publish records without pull/effect failure semantics (决策 40-2)', () => {
    configDeployments.forEach((d) => {
      if (d.channel === 'agent_pull') {
        // agent_pull 记录只记「发布配置包」中心动作：发布失败=中心侧平台故障，不承载拉包/生效失败
        // 「拉包/生效失败」不产生下发记录（由采集节点状态页 config_sync_status 承载）
        expect(d.error_message).not.toMatch(/reload|拉包|拉取|checksum|promtool/)
      }
    })
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

  it('should fix collector type to vmagent in MVP (决策 12 MVP 固定 vmagent)', () => {
    expect(MVP_AGENT_TYPE).toBe('vmagent')
    // prometheus-agent 保留枚举（AgentType）、v0.2+ 开放为可选
    expect(['vmagent', 'prometheus-agent']).toContain(MVP_AGENT_TYPE)
    // default 管理域固定 channel=local：不登记 Agent 类型（PRD 4.1 channel=local 时为空），不部署边缘采集器
    expect(networkDomains.find((d) => d.id === 'default')?.channel).toBe('local')
    expect(networkDomains.find((d) => d.id === 'default')?.agent_type).toBe('')
    // prometheus-agent 枚举保留用于 v0.2+ 演示（finance-dmz 域，channel=agent_pull）
    expect(networkDomains.some((d) => d.agent_type === 'prometheus-agent')).toBe(true)
  })

  it('should fix channel per domain (决策 32/33): default=local, others=agent_pull, no switch in MVP', () => {
    // MVP 通道按网域固定：default 固定 local，其他网域固定 agent_pull；不提供通道切换、不支持同域混合通道
    networkDomains.forEach((d) => {
      if (d.id === 'default') {
        expect(d.channel).toBe('local')
      } else {
        expect(d.channel).toBe('agent_pull')
      }
    })
    // 下发记录 channel 与对应 NetworkDomain.channel 一致（PRD 4.6）
    const channelByDomainId = Object.fromEntries(networkDomains.map((d) => [d.id, d.channel]))
    configDeployments.forEach((deployment) => {
      expect(deployment.channel).toBe(channelByDomainId[deployment.network_domain_id])
    })
    // 配置产物形态按下发通道分层（决策 32，与域类型解耦）
    networkDomains.forEach((d) => {
      const shape = domainArtifactShape(d)
      expect(shape).toBe(d.channel === 'agent_pull' ? 'zip_package' : 'local_files')
    })
  })

  it('should support per-domain filtering on edge agent status page (决策 13 网域筛选)', () => {
    // Agent 分布在多个 agent_pull 网域，支撑「选择网域」筛选下拉（仅列出存在 EdgeAgent 实例的网域）
    const domainsWithAgents = new Set(edgeAgents.map((a) => a.network_domain_id))
    expect(domainsWithAgents.size).toBeGreaterThan(1)
    // 每个 Agent 均可归属到已声明的网域（筛选后按 network_domain_id 匹配）
    const domainIds = new Set(networkDomains.map((d) => d.id))
    edgeAgents.forEach((a) => {
      expect(domainIds.has(a.network_domain_id)).toBe(true)
    })
  })

  it('should expose dimension-grouped fields on every edge agent (决策 13 维度分组)', () => {
    // Edge Sync Agent 维度：在线状态 / 最后心跳 / 配置同步状态 config_sync_status
    // 采集器维度：采集器状态 / 采集器版本 / WAL 积压 / remote_write 错误（last_error）
    edgeAgents.forEach((a) => {
      expect(['online', 'offline', 'unknown']).toContain(a.status)
      expect(a.last_heartbeat).toBeTruthy()
      expect(['in_sync', 'out_of_sync', 'unknown', 'manual_override', 'no_version']).toContain(a.config_sync_status)
      expect(['running', 'stopped', 'unknown']).toContain(a.collector_status)
      expect(a.collector_version).toBeTruthy()
      expect(typeof a.wal_backlog_bytes).toBe('number')
      expect(typeof a.last_error).toBe('string')
    })
  })

  it('should map every draft to a network domain name (所属网域列, PRD 3.4)', () => {
    const domainNameMap = Object.fromEntries(networkDomains.map((d) => [d.id, d.name]))
    configDrafts.forEach((draft) => {
      expect(domainNameMap[draft.network_domain_id]).toBeTruthy()
    })
  })

  it('should demonstrate pending-only default view distribution across domains (默认仅展示待确认草稿, PRD 3.4)', () => {
    // default 域：confirmed（draft-default-001/004）+ discarded（自动丢弃演示）+ pending（draft-default-003 校验失败）→ 默认视图有内容
    const defaultDrafts = configDrafts.filter((d) => d.network_domain_id === 'default')
    expect(defaultDrafts.some((d) => d.status === 'confirmed')).toBe(true)
    expect(defaultDrafts.some((d) => d.status === 'discarded')).toBe(true)
    expect(defaultDrafts.some((d) => d.status === 'pending')).toBe(true)
    // gov 域有 pending 草稿 → 默认视图有内容
    expect(configDrafts.some((d) => d.network_domain_id === 'gov-cloud-a' && d.status === 'pending')).toBe(true)
    // {v1.37} manufacturing-edge 未纳管：不再生成草稿（原 draft-mfg-001 已迁至 default 域，断点修复）
    expect(configDrafts.some((d) => d.network_domain_id === 'manufacturing-edge')).toBe(false)
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

  it('should expose per-domain change detection status with outcomes (PRD 3.3.3 检测状态可观测, {v1.37} P0)', () => {
    const domainIds = new Set(networkDomains.map((d) => d.id))
    const outcomes = new Set(changeDetectionStatus.map((s) => s.outcome))
    changeDetectionStatus.forEach((status) => {
      expect(domainIds.has(status.network_domain_id)).toBe(true)
      expect(status.last_checked_at).toBeTruthy()
      expect(status.source_data_version).toBeTruthy()
      expect(['changes_found', 'no_change', 'checksum_same', 'generation_failed']).toContain(status.outcome)
      expect(status.summary).toBeTruthy()
      // changes_found 引用的生成草稿必须真实存在
      status.generated_drafts.forEach((draft) => {
        expect(configDrafts.some((d) => d.id === draft.id)).toBe(true)
      })
    })
    // {v1.37} 检测结果演示：检测到变更（default / gov）/ 无变更跳过重算（finance）；
    // checksum 一致自动丢弃由 draft-default-002（discarded，checksum 与生效版本一致）覆盖验证
    expect(outcomes.has('changes_found')).toBe(true)
    expect(outcomes.has('no_change')).toBe(true)
    // default 最近一次检测与校验失败草稿（draft-default-003）联动（{v1.37} 断点修复）
    const defaultStatus = changeDetectionStatus.find((s) => s.network_domain_id === 'default')
    expect(defaultStatus?.outcome).toBe('changes_found')
    expect(configDrafts.find((d) => d.id === 'draft-default-003')).toBeDefined()
  })

  it('should categorize edge node components by type on every edge agent (决策 15 / PRD 3.2 组件分类 / 4.2 components)', () => {
    edgeAgents.forEach((agent) => {
      // 每个边缘节点至少包含 Edge Sync Agent + 采集器两个必装组件
      expect(agent.components.length).toBeGreaterThanOrEqual(2)
      const types = agent.components.map((c) => c.type)
      // Edge Sync Agent 必装（非中心平台内置，负责心跳 / 配置拉取 / 控制本节点组件）
      expect(types).toContain('edge_sync_agent')
      const syncAgent = agent.components.find((c) => c.type === 'edge_sync_agent')
      expect(syncAgent?.version).toBe(agent.version)
      // 采集器必装，组件版本与 collector_version 一致（PRD 4.2）
      const collector = agent.components.find((c) => c.type === 'collector')
      expect(collector).toBeDefined()
      expect(collector?.version).toBe(agent.collector_version)
      // 采集器组件状态与 collector_status 对齐（running / stopped / unknown）
      expect(collector?.status).toBe(agent.collector_status)
    })
  })

  it('should include blackbox exporter component only for domains with blackbox jobs (PRD 3.2 / 3.9 / 决策 15)', () => {
    // 存在 job_type=blackbox 的 ScrapeJob 的网域（prometheus.yml 骨架含 blackbox job）部署拨测器：gov-cloud-a；
    // default 管理域无 Agent 不涉及，finance / mfg 无 blackbox job 不部署
    const blackboxDomains = new Set(['gov-cloud-a'])
    edgeAgents.forEach((agent) => {
      const hasBlackbox = agent.components.some((c) => c.type === 'blackbox_exporter')
      expect(hasBlackbox).toBe(blackboxDomains.has(agent.network_domain_id))
    })
    // 拨测器状态均纳入组件清单展示
    edgeAgents
      .flatMap((a) => a.components)
      .filter((c) => c.type === 'blackbox_exporter')
      .forEach((c) => {
        expect(['running', 'stopped', 'unknown']).toContain(c.status)
        expect(c.version).toBeTruthy()
      })
  })

  it('should expose collector component name matching agent_type (vmagent / prometheus-agent, PRD 4.2)', () => {
    edgeAgents.forEach((agent) => {
      const collector = agent.components.find((c) => c.type === 'collector')
      if (agent.agent_type === 'vmagent') {
        expect(collector?.name).toContain('vmagent')
      } else {
        expect(collector?.name).toContain('prometheus-agent')
      }
    })
  })

  it('should auto-derive remote write url for new domains (决策 14 注册远程目标自动推导)', () => {
    expect(deriveRemoteWriteUrl('gov-cloud-b')).toBe(
      'https://metriccenter.example.com/api/v2/ingest/gov-cloud-b/prometheus'
    )
    expect(deriveRemoteWriteUrl('default')).toBe(
      'https://metriccenter.example.com/api/v2/ingest/default/prometheus'
    )
  })

  it('should not deploy edge agents in default management domain (决策 16 / 决策 32 / PRD 3.11)', () => {
    // default 固定 channel=local、由中心直接采集，不部署 Edge Agent → 不存在 network_domain_id='default' 的 EdgeAgent 实例
    expect(networkDomains.find((d) => d.id === 'default')?.channel).toBe('local')
    expect(edgeAgents.some((a) => a.network_domain_id === 'default')).toBe(false)
    // 所有有 Agent 的网域均为 edge 类型且 channel=agent_pull（Agent 状态页仅展示有 Agent 的网域，default 不出现）
    const agentDomainIds = new Set(edgeAgents.map((a) => a.network_domain_id))
    expect(agentDomainIds.size).toBeGreaterThan(1)
    agentDomainIds.forEach((id) => {
      const domain = networkDomains.find((d) => d.id === id)
      expect(domain?.domain_type).toBe('edge')
      expect(domain?.channel).toBe('agent_pull')
    })
  })

  it('should expose human-readable change summary and structured change items (决策 18 变更确认心智)', () => {
    configDrafts.forEach((draft) => {
      expect(draft.summary).toBeTruthy()
      expect(Array.isArray(draft.change_items)).toBe(true)
    })
    // 进入待确认列表的草稿必须有实际变更项（内容无影响的已自动丢弃）
    configDrafts
      .filter((d) => d.status === 'pending')
      .forEach((draft) => {
        expect(draft.change_items.length).toBeGreaterThan(0)
      })
    // 新增采集目标 = low 风险（draft-gov-001）
    const targetAdd = configDrafts.find((d) => d.id === 'draft-gov-001')
    expect(targetAdd?.change_items[0].type).toBe('add')
    expect(targetAdd?.change_items[0].risk).toBe('low')
    expect(targetAdd?.summary).toContain('10.0.1.11')
    // 告警规则变更 = high 风险，需醒目提示（draft-gov-002）
    const ruleChange = configDrafts.find((d) => d.id === 'draft-gov-002')
    expect(ruleChange?.status).toBe('pending')
    expect(ruleChange?.change_items.some((i) => i.risk === 'high')).toBe(true)
    expect(ruleChange?.change_items.some((i) => i.type === 'modify')).toBe(true)
    expect(ruleChange?.summary).toContain('HighCPUUsage')
    // 校验失败草稿（{v1.37} 断点修复：用户配置问题在 default 域，{v1.39} 决策 39-1 归因为 user_config）仍提供变更摘要（确认被下发前校验阻止，PRD 3.5.1）
    const failed = configDrafts.find((d) => d.id === 'draft-default-003')
    expect(failed?.summary).toBeTruthy()
    expect(failed?.network_domain_id).toBe('default')
    expect(failed?.validation_cause).toBe('user_config')
    // 自动丢弃草稿无实际变更项
    const autoDiscarded = configDrafts.find((d) => d.id === 'draft-default-002')
    expect(autoDiscarded?.change_items.length).toBe(0)
  })

  it('should let affected config files be derivable from draft vs effective version (决策 19 受影响文件高亮)', () => {
    // gov 目标新增草稿：prometheus.yml 骨架 / rules 不变（不受影响），targets 变化（受影响）
    const baseline = configVersions.find((v) => v.id === 'cv-gov-001')
    const draft = configDrafts.find((d) => d.id === 'draft-gov-001')
    expect(draft?.prometheus_yml).toBe(baseline?.prometheus_yml)
    expect(draft?.rules_yml).toBe(baseline?.rules_yml)
    expect(draft?.targets_files).not.toEqual(baseline?.targets_files)
    // 规则变更草稿：rules 变化（受影响），prometheus.yml / targets 不变（不受影响）
    const ruleDraft = configDrafts.find((d) => d.id === 'draft-gov-002')
    expect(ruleDraft?.rules_yml).not.toBe(baseline?.rules_yml)
    expect(ruleDraft?.prometheus_yml).toBe(baseline?.prometheus_yml)
    expect(ruleDraft?.targets_files).toEqual(draft?.targets_files)
  })

  it('should demonstrate business ownership change as a low-risk targets-only rewrite (2026-08-19 业务-网域正交性)', () => {
    // 业务归属变更草稿（draft-gov-004）：10.0.1.11 的 biz 由 data-api → risk——真实拓扑变化，仅重写 targets/node-exporter.json
    const bizChange = configDrafts.find((d) => d.id === 'draft-gov-004')
    expect(bizChange).toBeDefined()
    expect(bizChange?.status).toBe('pending')
    expect(bizChange?.change_items[0].target).toBe('scrape_target')
    expect(bizChange?.change_items[0].type).toBe('modify')
    expect(bizChange?.change_items[0].risk).toBe('low')
    expect(bizChange?.change_items[0].affected_files).toEqual(['targets'])
    // 与生效版本 cv-gov-002 相比：prometheus.yml 骨架 / rules.yml 不变，仅 targets 变化
    const version = configVersions.find((v) => v.id === 'cv-gov-002')
    expect(bizChange?.prometheus_yml).toBe(version?.prometheus_yml)
    expect(bizChange?.rules_yml).toBe(version?.rules_yml)
    expect(bizChange?.targets_files).not.toEqual(version?.targets_files)
    // 多业务共用 1 网域：gov-cloud-a 的 node-exporter targets 同时包含 data-api 与 risk 两个 biz 值（网域与业务正交）
    const nodeTargets = (bizChange?.targets_files as ConfigTargetsFiles)['node-exporter']
    const bizValues = Array.isArray(nodeTargets) ? nodeTargets.map((t) => t.labels.biz) : []
    expect(bizValues).toContain('data-api')
    expect(bizValues).toContain('risk')
  })

  it('should record confirmer on confirmed drafts for change audit (决策 19 确认人)', () => {
    // 已确认草稿必须有确认人与确认时间（变更管理审计）；pending / discarded 不要求
    configDrafts
      .filter((d) => d.status === 'confirmed')
      .forEach((d) => {
        expect(d.confirmed_by).toBeTruthy()
        expect(d.confirmed_at).toBeTruthy()
      })
    const confirmed = configDrafts.find((d) => d.status === 'confirmed')
    expect(confirmed?.confirmed_by).toBeTruthy()
  })

  it('should expose unique human-readable change numbers (决策 20 变更单号)', () => {
    const changeNos = configDrafts.map((d) => d.change_no)
    // 变更单号为用户可读唯一标识，全局唯一
    expect(new Set(changeNos).size).toBe(changeNos.length)
    // 格式：CHG-YYYYMMDD-NNN
    changeNos.forEach((no) => {
      expect(no).toMatch(/^CHG-\d{8}-\d{3}$/)
    })
  })

  it('should unify change object as source-data-object enum and derive affected config files (决策 22 变更对象与影响文件)', () => {
    const validTargets: ConfigChangeTarget[] = ['scrape_job', 'scrape_target', 'alert_rule', 'blackbox_target', 'label_template']
    const validFiles: AffectedConfigFile[] = ['prometheus.yml', 'targets', 'rules.yml', 'blackbox.yml']
    // 所有变更项的变更对象均为统一枚举，且必须携带非空、合法的「影响的配置文件」
    configDrafts.forEach((draft) => {
      draft.change_items.forEach((item) => {
        expect(validTargets).toContain(item.target)
        expect(item.affected_files.length).toBeGreaterThan(0)
        item.affected_files.forEach((f) => expect(validFiles).toContain(f))
      })
    })
    // 语义映射：采集目标变化 → 仅 targets；告警规则变化 → 仅 rules.yml；新增采集 Job → prometheus.yml + targets
    const targetAdd = configDrafts.find((d) => d.id === 'draft-gov-001')
    expect(targetAdd?.change_items[0].target).toBe('scrape_target')
    expect(targetAdd?.change_items[0].affected_files).toEqual(['targets'])
    const ruleChange = configDrafts.find((d) => d.id === 'draft-gov-002')
    expect(ruleChange?.change_items[0].target).toBe('alert_rule')
    expect(ruleChange?.change_items[0].affected_files).toEqual(['rules.yml'])
    const jobAdd = configDrafts.find((d) => d.id === 'draft-default-003')
    expect(jobAdd?.change_items[0].target).toBe('scrape_job')
    expect(jobAdd?.change_items[0].affected_files).toContain('prometheus.yml')
    expect(jobAdd?.change_items[0].affected_files).toContain('targets')
  })

  it('should trace full chain: change_no → config version → deployment (决策 22 全链路关联)', () => {
    // ConfigVersion 继承来源 draft 的变更单号（change_no → 配置版本 cv-xxx）
    configVersions.forEach((v) => {
      const draft = configDrafts.find((d) => d.id === v.draft_id)
      expect(draft?.change_no).toBe(v.change_no)
    })
    // 每条下发记录的来源变更单号 = 其配置版本对应的变更单号（deploy → cv → change_no 链路一致）
    const changeNoByVersion = Object.fromEntries(configVersions.map((v) => [v.id, v.change_no]))
    configDeployments.forEach((d) => {
      expect(d.source_change_no).toBe(changeNoByVersion[d.config_version_id])
      expect(d.source_change_no).toMatch(/^CHG-\d{8}-\d{3}$/)
    })
  })

  it('should expose zone_type and center_endpoint on every domain (PRD 4.1 / {v1.31} 网闸拓扑 / {v1.33} 通道)', () => {
    networkDomains.forEach((d) => {
      // zone_type：M06 行政字段（可空，未登记为空）
      expect(typeof d.zone_type).toBe('string')
      // center_endpoint：该网域视角的中心可达地址；agent_pull 通道纳管必填，local 通道为空（PRD 4.1）
      expect(typeof d.center_endpoint).toBe('string')
      if (d.channel === 'local') {
        expect(d.center_endpoint).toBe('')
      }
    })
    // 已纳管 agent_pull 网域均已配置 center_endpoint（网闸映射后的中心可达地址，用于合成配置包绝对下载地址，PRD 6.1）
    const agentPullDomains = networkDomains.filter((d) => d.channel === 'agent_pull' && d.registration_status === 'monitored')
    expect(agentPullDomains.length).toBeGreaterThan(0)
    agentPullDomains.forEach((d) => {
      expect(d.center_endpoint).toMatch(/^https:\/\//)
    })
    // zone_type 值集：政务云预置 internet / extranet（M06 登记，示例网域）
    expect(networkDomains.some((d) => d.zone_type === 'extranet')).toBe(true)
    expect(networkDomains.some((d) => d.zone_type === 'internet')).toBe(true)
  })

  it('should inject external_labels.zone_type only when domain registered zone_type (PRD 9.2 / {v1.31})', () => {
    // 已登记 zone_type 的网域（gov-cloud-a=extranet / finance-dmz=internet）→ prometheus.yml 注入 zone_type
    const govDraft = configDrafts.find((d) => d.network_domain_id === 'gov-cloud-a')
    expect(govDraft?.prometheus_yml).toContain("zone_type: 'extranet'")
    const financeDraft = configDrafts.find((d) => d.network_domain_id === 'finance-dmz')
    expect(financeDraft?.prometheus_yml).toContain("zone_type: 'internet'")
    // {v1.37} manufacturing-edge 未纳管 → 不生成配置草稿（PRD 3.4「未纳管网域不生成配置草稿」，断点修复）
    expect(configDrafts.some((d) => d.network_domain_id === 'manufacturing-edge')).toBe(false)
    // 管理域（default）无网闸拓扑 → 不注入 zone_type
    const defaultDraft = configDrafts.find((d) => d.network_domain_id === 'default')
    expect(defaultDraft?.prometheus_yml).not.toContain('zone_type:')
    // {v1.45} 所有 prometheus.yml 均注入部署级元数据 network_domain_id / replica；不注入 tenant_id / 业务标签
    // （biz / tenant 由 M07 LabelTemplate 以 target 级注入 targets/*.json，见 PRD 3.3/3.3.1、决策 19/23）
    configDrafts.forEach((draft) => {
      expect(draft.prometheus_yml).toContain('network_domain_id:')
      expect(draft.prometheus_yml).toContain('replica:')
      expect(draft.prometheus_yml).not.toContain('tenant_id:')
    })
  })

  it('should synthesize absolute config download url from center_endpoint (PRD 6.1 / {v1.31})', () => {
    const gov = networkDomains.find((d) => d.id === 'gov-cloud-a')
    expect(deriveConfigDownloadUrl(gov!)).toBe('https://10.8.0.5:8443/api/v2/platform/edge/config?network_domain=gov-cloud-a')
    // 管理域（center_endpoint 为空）不走协议 → 返回空
    const defaultDomain = networkDomains.find((d) => d.id === 'default')
    expect(deriveConfigDownloadUrl(defaultDomain!)).toBe('')
  })

  it('should describe approval tiering: alertmanager.yml managed by Module_08, not in M09 flow (PRD 3.4 / {v1.32})', () => {
    // 人工确认：prometheus.yml / targets / rules.yml / blackbox.yml
    expect(approvalTieringNote.manual).toContain('prometheus.yml')
    expect(approvalTieringNote.manual).toContain('targets')
    expect(approvalTieringNote.manual).toContain('rules.yml')
    expect(approvalTieringNote.manual).toContain('blackbox.yml')
    expect(approvalTieringNote.manual).toContain('人工确认')
    // 自动生效：alertmanager.yml 由 Module_08 直接管理，不进入本模块变更确认流程
    expect(approvalTieringNote.auto).toContain('alertmanager.yml')
    expect(approvalTieringNote.auto).toContain('Module_08')
    expect(approvalTieringNote.auto).toContain('不进入')
    // 混单规则：按高风险文件走人工确认
    expect(approvalTieringNote.mixed).toContain('高风险文件')
    // 原因：通知路由调整频繁、风险低、M08 是 Alertmanager 唯一 Owner
    expect(approvalTieringNote.reason).toContain('唯一 Owner')
    // 配置产物不包含 alertmanager.yml（ConfigDraft / 配置包均不含，PRD 6.2 / 3.11）
    configDrafts.forEach((draft) => {
      expect(draft.prometheus_yml).not.toContain('alertmanager')
      expect(draft.rules_yml).not.toContain('alertmanager')
      expect(draft.blackbox_yml).not.toContain('alertmanager')
    })
  })

  it('should organize rules.yml by Prometheus group syntax with auto-derived groups (PRD 3.3 / {v1.32})', () => {
    // M09 按 Prometheus group 语法组织 rules.yml（内部自动派生分组，MVP 不暴露 RuleGroup 实体）
    configDrafts.forEach((draft) => {
      if (draft.rules_yml) {
        expect(draft.rules_yml).toContain('groups:')
        expect(draft.rules_yml).toMatch(/name: [a-z0-9.]+/i)
      }
    })
    expect(rulesGroupDerivationNote).toContain('group')
    expect(rulesGroupDerivationNote).toContain('自动派生')
    expect(rulesGroupDerivationNote).toContain('scope')
  })

  it('should describe gateway/zone isolation connection constraint (PRD §6 / {v1.31})', () => {
    // 禁止中心 → 边缘主动连接：所有交互由边缘 Agent 发起
    expect(gatewayConstraintNote).toContain('禁止任何中心')
    expect(gatewayConstraintNote).toContain('边缘')
    expect(gatewayConstraintNote).toContain('中心无入站端口')
    expect(gatewayConstraintNote).toContain('可达地址')
    expect(edgeAgentInstallGuide.gateway_note).toContain('pull')
    expect(edgeAgentInstallGuide.gateway_note).toContain('center_endpoint')
  })

  it('should passthrough采集认证/TLS mapping into scrape_configs (决策 31, MVP, PRD v1.50)', () => {
    // 认证 / TLS 由 M01（ScrapeJob）配置、本模块仅透传映射、无新机制（决策 31）
    expect(authTlsPassthroughNote).toContain('透传映射')
    expect(authTlsPassthroughNote).toContain('basic_auth')
    expect(authTlsPassthroughNote).toContain('authorization')
    expect(authTlsPassthroughNote).toContain('insecure_skip_verify')
    expect(authTlsPassthroughNote).toContain('ca_file')
    expect(authTlsPassthroughNote).toContain('无新机制')
    // gov-cloud-a 域 prometheus.yml 子配置示例：node-exporter job 透传 basic_auth + tls_config；blackbox-http job 透传 tls_config
    const govDraft = configDrafts.find((d) => d.network_domain_id === 'gov-cloud-a')
    expect(govDraft?.prometheus_yml).toContain('basic_auth:')
    expect(govDraft?.prometheus_yml).toContain('tls_config:')
    expect(govDraft?.prometheus_yml).toContain('insecure_skip_verify: true')
    expect(govDraft?.prometheus_yml).toContain('ca_file:')
    // 认证 / TLS 仅作透传，不注入 external_labels 租户 / 业务标签（与 v1.45 收敛保持一致）
    expect(govDraft?.prometheus_yml).not.toContain('tenant_id:')
    // blackbox HTTP/HTTPS 拨测模块同理透传 tls_config
    expect(govDraft?.prometheus_yml).toMatch(/job_name: 'blackbox-http'[\s\S]*tls_config:/)
  })

  it('should reflect deployed status write-back as MVP (决策 31-M2, PRD v1.50)', () => {
    // {v1.50 决策 31-M2} 成功下发即回写 deployed（不再由 none 占位），消除「已生效 vs 无变更」歧义
    expect(changeStatusEnumDemo.deployed).toContain('deployed')
    expect(changeStatusEnumDemo.deployed).toContain('MVP')
    expect(changeStatusEnumDemo.deployed).not.toContain('由 none 占位')
  })

  it('should exclude frozen domains from generating new change orders and drop default fallback (决策 30 / 31-M3, PRD v1.50)', () => {
    // 冻结（禁用）网域不生成新变更单；存量下发与回滚不受影响（决策 30）
    expect(frozenDomainExclusionNote).toContain('不再产生新变更单')
    expect(frozenDomainExclusionNote).toContain('存量')
    expect(frozenDomainExclusionNote).toContain('回滚不受影响')
    // 删除「未指定网域资源自动归 default」兜底；network_domain_id 由 M07 导入校验强制必填（决策 31-M3）
    expect(defaultFallbackRemovalNote).toContain('不再自动归入 default')
    expect(defaultFallbackRemovalNote).toContain('强制必填')
  })
})
