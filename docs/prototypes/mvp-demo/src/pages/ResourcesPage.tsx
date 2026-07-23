import { Card, Table, Tabs, Tag, Button, Space, Upload } from 'antd'
import { UploadOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { hosts, middlewares, applications } from '../mocks/resources'

const statusColor = {
  online: 'green',
  offline: 'red',
  maintenance: 'orange',
}

export function ResourcesPage() {
  return (
    <MainLayout>
      <Card
        title="资源管理"
        extra={
          <Space>
            <Button icon={<DownloadOutlined />}>下载模板</Button>
            <Upload>
              <Button icon={<UploadOutlined />}>Excel 导入</Button>
            </Upload>
            <Button type="primary" icon={<PlusOutlined />}>新增资源</Button>
          </Space>
        }
      >
        <Tabs
          items={[
            {
              key: 'host',
              label: `主机 (${hosts.length})`,
              children: (
                <Table
                  dataSource={hosts}
                  rowKey="id"
                  size="small"
                  columns={[
                    { title: '主机名', dataIndex: 'hostname', key: 'hostname' },
                    { title: 'IP', dataIndex: 'instance_ip', key: 'instance_ip' },
                    { title: 'OS', dataIndex: 'os_type', key: 'os_type' },
                    { title: '应用', dataIndex: 'app_name', key: 'app_name' },
                    { title: '环境', dataIndex: 'env', key: 'env' },
                    { title: '集群', dataIndex: 'cluster', key: 'cluster' },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      key: 'status',
                      render: (status: keyof typeof statusColor) => <Tag color={statusColor[status]}>{status}</Tag>,
                    },
                  ]}
                />
              ),
            },
            {
              key: 'middleware',
              label: `中间件 (${middlewares.length})`,
              children: (
                <Table
                  dataSource={middlewares}
                  rowKey="id"
                  size="small"
                  columns={[
                    { title: '类型', dataIndex: 'middleware_type', key: 'middleware_type' },
                    { title: 'IP', dataIndex: 'instance_ip', key: 'instance_ip' },
                    { title: '端口', dataIndex: 'port', key: 'port' },
                    { title: '版本', dataIndex: 'version', key: 'version' },
                    { title: '应用', dataIndex: 'app_name', key: 'app_name' },
                    { title: '环境', dataIndex: 'env', key: 'env' },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      key: 'status',
                      render: (status: keyof typeof statusColor) => <Tag color={statusColor[status]}>{status}</Tag>,
                    },
                  ]}
                />
              ),
            },
            {
              key: 'application',
              label: `应用服务 (${applications.length})`,
              children: (
                <Table
                  dataSource={applications}
                  rowKey="id"
                  size="small"
                  columns={[
                    { title: '服务名', dataIndex: 'service_name', key: 'service_name' },
                    { title: '拨测 URL', dataIndex: 'health_check_url', key: 'health_check_url', ellipsis: true },
                    { title: '协议', dataIndex: 'protocol', key: 'protocol' },
                    { title: '指标端点', dataIndex: 'endpoint', key: 'endpoint' },
                    { title: '应用', dataIndex: 'app_name', key: 'app_name' },
                    { title: '环境', dataIndex: 'env', key: 'env' },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      key: 'status',
                      render: (status: keyof typeof statusColor) => <Tag color={statusColor[status]}>{status}</Tag>,
                    },
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

export default ResourcesPage
