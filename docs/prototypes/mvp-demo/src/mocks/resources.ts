export interface Host {
  id: string
  network_domain_id: string
  hostname: string
  instance_ip: string
  os_type: string
  app_name: string
  env: string
  cluster: string
  status: 'online' | 'offline' | 'maintenance'
}

export interface Middleware {
  id: string
  network_domain_id: string
  middleware_type: string
  instance_ip: string
  port: number
  version: string
  app_name: string
  env: string
  cluster: string
  status: 'online' | 'offline' | 'maintenance'
}

export interface Application {
  id: string
  network_domain_id: string
  service_name: string
  health_check_url: string
  protocol: string
  endpoint: string
  port: number
  app_name: string
  env: string
  cluster: string
  status: 'online' | 'offline' | 'maintenance'
}

export const hosts: Host[] = [
  { id: 'h1', network_domain_id: 'default', hostname: 'host-01', instance_ip: '10.0.1.10', os_type: 'linux', app_name: 'order-service', env: 'prod', cluster: 'bj-01', status: 'online' },
  { id: 'h2', network_domain_id: 'default', hostname: 'host-02', instance_ip: '10.0.1.11', os_type: 'linux', app_name: 'order-service', env: 'prod', cluster: 'bj-01', status: 'online' },
  { id: 'h3', network_domain_id: 'gov-cloud-a', hostname: 'host-03', instance_ip: '10.0.2.20', os_type: 'linux', app_name: 'user-service', env: 'staging', cluster: 'sh-01', status: 'maintenance' },
]

export const middlewares: Middleware[] = [
  { id: 'm1', network_domain_id: 'default', middleware_type: 'mysql', instance_ip: '10.0.1.50', port: 3306, version: '8.0', app_name: 'order-service', env: 'prod', cluster: 'bj-01', status: 'online' },
  { id: 'm2', network_domain_id: 'default', middleware_type: 'redis', instance_ip: '10.0.1.51', port: 6379, version: '7.0', app_name: 'order-service', env: 'prod', cluster: 'bj-01', status: 'online' },
  { id: 'm3', network_domain_id: 'gov-cloud-a', middleware_type: 'kafka', instance_ip: '10.0.2.60', port: 9092, version: '3.5', app_name: 'user-service', env: 'staging', cluster: 'sh-01', status: 'offline' },
]

export const applications: Application[] = [
  { id: 'a1', network_domain_id: 'default', service_name: 'order-service', health_check_url: 'https://order.example.com/api/health', protocol: 'https', endpoint: '/metrics', port: 8080, app_name: 'order-service', env: 'prod', cluster: 'bj-01', status: 'online' },
  { id: 'a2', network_domain_id: 'gov-cloud-a', service_name: 'user-service', health_check_url: 'https://user.example.com/api/health', protocol: 'https', endpoint: '/metrics', port: 8080, app_name: 'user-service', env: 'prod', cluster: 'bj-01', status: 'online' },
  { id: 'a3', network_domain_id: 'finance-dmz', service_name: 'payment-service', health_check_url: 'https://pay.example.com/api/health', protocol: 'https', endpoint: '/metrics', port: 8080, app_name: 'payment-service', env: 'staging', cluster: 'sh-01', status: 'offline' },
]
