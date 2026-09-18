import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { SkinProvider } from './SkinProvider.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* SkinProvider 内部持有 antd ConfigProvider（theme 随皮肤切换）+ antd App 上下文，
        故此处不再直接使用 ConfigProvider；皮肤偏好见 skinPreference.ts，色值见 skins.ts。 */}
    <SkinProvider>
      <App />
    </SkinProvider>
  </React.StrictMode>,
)
