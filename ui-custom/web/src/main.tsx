import React from 'react'
import ReactDOM from 'react-dom/client'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App.tsx'
import volcengineTheme from './theme.ts'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={volcengineTheme}>
      {/* antd App 上下文：App.useApp()（message/notification/modal）必须在其内使用，
          否则解构结果为 undefined（生产环境 message.success is not a function 的根因）。
          注意 <App />（下方）是项目路由组件，不是 antd App。 */}
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
)