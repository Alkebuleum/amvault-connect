import React from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from 'amvault-connect'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <AuthProvider
    config={{
      appName: 'ExampleApp',
      chainId: 12345,
      amvaultUrl: (import.meta as any).env?.VITE_AMVAULT_URL || 'https://amvault.example.com/router',
      debug: true
    }}
  >
    <App/>
  </AuthProvider>
)
