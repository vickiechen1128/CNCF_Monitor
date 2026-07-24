export const queryResult = {
  status: 'success',
  data: {
    resultType: 'matrix',
    result: [
      {
        metric: { __name__: 'node_cpu_seconds_total', instance: '10.0.1.10:9100', mode: 'idle', network_domain: 'default', source_type: 'edge_agent' },
        values: [
          [1721541600, '1234567.89'] as [number, string],
          [1721541660, '1234597.34'] as [number, string],
          [1721541720, '1234626.78'] as [number, string],
        ],
      },
      {
        metric: { __name__: 'node_cpu_seconds_total', instance: '10.0.1.11:9100', mode: 'idle', network_domain: 'default', source_type: 'edge_agent' },
        values: [
          [1721541600, '987654.32'] as [number, string],
          [1721541660, '987684.76'] as [number, string],
          [1721541720, '987715.20'] as [number, string],
        ],
      },
      {
        metric: { __name__: 'node_cpu_seconds_total', instance: '10.0.2.20:9100', mode: 'idle', network_domain: 'gov-cloud-a', source_type: 'edge_agent' },
        values: [
          [1721541600, '456789.12'] as [number, string],
          [1721541660, '456819.56'] as [number, string],
          [1721541720, '456850.00'] as [number, string],
        ],
      },
    ],
  },
}

export const labelSuggestions = [
  'node_cpu_seconds_total{network_domain="gov-cloud-a"}',
  'node_memory_MemAvailable_bytes{network_domain="default"}',
  'probe_success{source_type="external_prometheus"}',
  'probe_duration_seconds',
  'up{network_domain="finance-dmz"}',
]

export const savedQueries = [
  { id: '1', name: 'CPU 使用率', expr: '100 - (avg by (instance, network_domain) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80' },
  { id: '2', name: '内存可用率', expr: 'node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes * 100' },
  { id: '3', name: '拨测成功率', expr: 'probe_success' },
  { id: '4', name: '跨网域统一查询', expr: 'up{network_domain=~"default|gov-cloud-a"}' },
]
