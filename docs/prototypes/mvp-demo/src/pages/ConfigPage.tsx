import { Card, Table, Tabs, Tag, Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { labelTemplates, scrapeJobs, probeConfigs } from '../mocks/config'

export function ConfigPage() {
  return (
    <MainLayout>
      <Card title="配置管理">
        <Tabs
          items={[
            {
              key: 'label-template',
              label: '标签模板',
              children: (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <Button type="primary" icon={<PlusOutlined />}>新增标签模板</Button>
                  </div>
                  <Table
                    dataSource={labelTemplates}
                    rowKey="id"
                    size="small"
                    columns={[
                      { title: '模板名', dataIndex: 'name', key: 'name' },
                      { title: '适用资源类型', dataIndex: 'resource_type', key: 'resource_type' },
                      {
                        title: '字段映射',
                        dataIndex: 'mappings',
                        key: 'mappings',
                        render: (mappings: { source_field: string; target_label: string }[]) =>
                          mappings.map((m) => `${m.source_field} → ${m.target_label}`).join(', '),
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'scrape-job',
              label: '采集 Job',
              children: (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <Button type="primary" icon={<PlusOutlined />}>新增采集 Job</Button>
                  </div>
                  <Table
                    dataSource={scrapeJobs}
                    rowKey="id"
                    size="small"
                    columns={[
                      { title: 'Job 名', dataIndex: 'job_name', key: 'job_name' },
                      { title: '网域', dataIndex: 'network_domain_id', key: 'network_domain_id' },
                      { title: '资源类型', dataIndex: 'resource_type', key: 'resource_type' },
                      { title: '抓取间隔', dataIndex: 'scrape_interval', key: 'scrape_interval' },
                      { title: '超时', dataIndex: 'scrape_timeout', key: 'scrape_timeout' },
                      { title: '路径', dataIndex: 'metrics_path', key: 'metrics_path' },
                      { title: '协议', dataIndex: 'scheme', key: 'scheme' },
                      {
                        title: '状态',
                        dataIndex: 'enabled',
                        key: 'enabled',
                        render: (enabled: boolean) => <Tag color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '禁用'}</Tag>,
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'probe-config',
              label: '拨测配置',
              children: (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <Button type="primary" icon={<PlusOutlined />}>新增拨测配置</Button>
                  </div>
                  <Table
                    dataSource={probeConfigs}
                    rowKey="id"
                    size="small"
                    columns={[
                      { title: 'Job 名', dataIndex: 'job_name', key: 'job_name' },
                      { title: '网域', dataIndex: 'network_domain_id', key: 'network_domain_id' },
                      { title: '模块', dataIndex: 'module', key: 'module' },
                      {
                        title: '目标',
                        dataIndex: 'targets',
                        key: 'targets',
                        render: (targets: string[]) => targets.join(', '),
                      },
                      { title: '间隔', dataIndex: 'scrape_interval', key: 'scrape_interval' },
                      {
                        title: '状态',
                        dataIndex: 'enabled',
                        key: 'enabled',
                        render: (enabled: boolean) => <Tag color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '禁用'}</Tag>,
                      },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>
    </MainLayout>
  )
}

export default ConfigPage
