import { Spin } from 'antd'

interface LoadingPlaceholderProps {
  tip?: string
}

export function LoadingPlaceholder({ tip = '加载中...' }: LoadingPlaceholderProps) {
  return <Spin tip={tip} />
}
