import { useEffect, useState } from 'react'
import { Alert, Button, Descriptions, Empty, Spin, Tooltip, Typography, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { edgePackageApi } from '../../../api/edgePackages'
import type { EdgePackage } from '../../../types/config-center'
import { triggerBlobDownload } from '../../../utils/triggerBlobDownload'

const { Text } = Typography

/** sha256 摘要展示长度（省略号 + Tooltip 全量） */
const SHA_PREFIX_LEN = 16

/** 将字节数格式化为可读大小（B / KB / MB / GB），供包大小列展示 */
function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = units[0]
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024
    unit = units[i]
  }
  return `${value.toFixed(unit === 'B' ? 0 : 2)} ${unit}`
}

/**
 * 下载文件名：优先用后端 `release_meta.json` 提供的真实 tar.gz 产物名（`pkg.file`）；
 * 缺失时回落为真实构建产物命名约定 edge-sync-agent-<version>-linux-amd64.tar.gz。
 */
function offlineFilename(pkg: EdgePackage): string {
  return pkg.file ?? `edge-sync-agent-${pkg.version}-linux-amd64.tar.gz`
}

/**
 * 顶部安装指引·下载安装包（T11-22 实连）。
 * 拉取 /edge-packages 版本清单，每条展示版本 / 大小 / sha256（省略 + Tooltip）/ 组件版本，
 * 附「下载」按钮触发 tar.gz 二进制下载（rawRequest 带认证，triggerBlobDownload 触发浏览器下载）。
 * 列表加载失败 / 下载失败分别给出 error 提示。
 * 懒加载：`active` 为 false 时不发起请求（配合父级 Collapse 折叠态；默认 true 兼容独立挂载）。
 */
export function EdgePackageDownloadPanel({ active = true }: { active?: boolean }) {
  const [packages, setPackages] = useState<EdgePackage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [downloadingVersion, setDownloadingVersion] = useState<string | null>(null)

  useEffect(() => {
    // 折叠/关闭态不拉取（保留懒加载语义）；每次 active 转 true 都重新拉取清单：
    // 清单应反映最新构建产物，比一次性缓存更正确，且只是很小的 JSON 元数据。
    // 关键：不能加「只抓一次」的一次性守卫——React.StrictMode 下 dev 会 effect(执行→清理→再执行)，
    // 一次性守卫会让第二次执行直接 return，而第一次请求的回调已被 cancelled 挡住，
    // 导致 setLoading(false) 永不落地、面板永久转圈。
    if (!active) return
    let cancelled = false
    // 重新激活时同步回落 loading / 清空残留 error，属「重新进入刷新」语义（非级联渲染）；
    // 沿用本模块 NetworkDomainsPage 对 react-hooks/set-state-in-effect 的处理方式
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true)
    setLoadError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    edgePackageApi
      .list()
      .then((res) => {
        if (cancelled) return
        setPackages(res.data ?? [])
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '离线包清单加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active])

  const handleDownload = async (pkg: EdgePackage) => {
    setDownloadingVersion(pkg.version)
    try {
      const blob = await edgePackageApi.download(pkg.version)
      triggerBlobDownload(blob, offlineFilename(pkg))
      message.success(`安装包 ${pkg.version} 下载已开始`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '安装包下载失败，请稍后重试')
    } finally {
      setDownloadingVersion(null)
    }
  }

  if (loading) {
    return <Spin size="small" style={{ margin: '8px 0' }} />
  }

  if (loadError) {
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginTop: 12 }}
        message="离线安装包清单加载失败，请稍后重试"
        description={loadError}
      />
    )
  }

  if (packages.length === 0) {
    return (
      <div style={{ marginTop: 12 }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可下载的离线安装包" />
      </div>
    )
  }

  return (
    <div style={{ marginTop: 8 }}>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>
        离线安装包
      </Text>
      {packages.map((pkg) => (
        <div
          key={pkg.version}
          style={{
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 8,
          }}
        >
          <Descriptions
            column={1}
            size="small"
            style={{ marginBottom: 8 }}
            labelStyle={{ width: 96, color: 'rgba(0,0,0,0.65)' }}
          >
            <Descriptions.Item label="版本">{pkg.version}</Descriptions.Item>
            <Descriptions.Item label="大小">{formatFileSize(pkg.size_bytes)}</Descriptions.Item>
            <Descriptions.Item label="SHA256">
              <Tooltip title={pkg.sha256}>
                <Text code style={{ fontSize: 12 }}>
                  {pkg.sha256.length > SHA_PREFIX_LEN
                    ? `${pkg.sha256.slice(0, SHA_PREFIX_LEN)}…`
                    : pkg.sha256}
                </Text>
              </Tooltip>
            </Descriptions.Item>
            <Descriptions.Item label="组件">
              {pkg.components.map((c) => (
                <TagLike key={`${c.name}-${c.version}`} text={`${c.name} ${c.version}`} />
              ))}
            </Descriptions.Item>
          </Descriptions>
          <Button
            type="primary"
            size="small"
            icon={<DownloadOutlined />}
            loading={downloadingVersion === pkg.version}
            onClick={() => handleDownload(pkg)}
          >
            下载安装包
          </Button>
        </div>
      ))}
    </div>
  )
}

/** 组件版本标签（内联样式小程序件，避免散点 Space wrap 堆砌长文本） */
function TagLike({ text }: { text: string }) {
  return (
    <Typography.Text
      style={{
        display: 'inline-block',
        marginRight: 8,
        padding: '1px 8px',
        background: 'rgba(0,0,0,0.04)',
        borderRadius: 4,
        fontSize: 12,
        lineHeight: '20px',
      }}
    >
      {text}
    </Typography.Text>
  )
}

export default EdgePackageDownloadPanel