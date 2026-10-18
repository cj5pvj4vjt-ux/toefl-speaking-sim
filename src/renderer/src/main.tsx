import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root 不存在')

// 不使用 StrictMode：避免开发模式下 effect 双调用干扰录音状态机
createRoot(container).render(<App />)
