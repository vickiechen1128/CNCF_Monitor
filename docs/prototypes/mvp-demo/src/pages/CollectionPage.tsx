import { Card, Table, Tabs, Tag } from 'antd'
import { MainLayout } from '../layouts/MainLayout'
import { scrapeTargets, probeResults } from '../mocks/collection'

const statusColor = {
  up: 'green',
  down: 'red',
  unknown: 'default',
}

export function CollectionPage() {
  return (
    <MainLayout>
      <Card title="采集状态与诊断">
        <Tabs
          items={[
            {
              key: 'targets',
              label: '采集目标',
              children: (
                <Table
                  dataSource={scrapeTargets}
                  rowKey="id"
                  size="small"
                  columns={[
                    { title: 'Job', dataIndex: 'job', key: 'job' },
                    { title: 'Instance', dataIndex: 'instance', key: 'instance' },
                    { title: '资源类型', dataIndex: 'resource_type', key: 'resource_type' },
                    { title: '应用', dataIndex: 'app', key: 'app' },
                    { title: '环境', dataIndex: 'env', key: 'env' },
                    { title: '集群', dataIndex: 'cluster', key: 'cluster' },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      key: 'status',
                      render: (status: keyof typeof statusColor) => <Tag color={statusColor[status]}>{status}</Tag>,
                    },
                    { title: '最近抓取', dataIndex: 'last_scrape', key: 'last_scrape' },
                    { title: '错误信息', dataIndex: 'last_error', key: 'last_error' },
                  ]}
                />
              ),
            },
            {
              key: 'probes',
              label: '拨测结果',
              children: (
                <Table
                  dataSource={probeResults}
                  rowKey="id"
                  size="small"
                  columns={[
                    { title: '目标', dataIndex: 'target', key: 'target', ellipsis: true },
                    { title: 'Job', dataIndex: 'job', key: 'job' },
                    {
                      title: '拨测成功',
                      dataIndex: 'probe_success',
                      key: 'probe_success',
                      render: (v: number) => <Tag color={v ? 'green' : 'red'}>{v ? '成功' : '失败'}</Tag>,
                    },
                    { title: '拨测耗时 (s)', dataIndex: 'probe_duration', key: 'probe_duration' },
                    { title: '最近抓取', dataIndex: 'last_scrape', key: 'last_scrape' },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
    </MainLayout>
  )
}

export default CollectionPage
