import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import "./globals.css";
import { ConnectProvider } from './providers/ConnectProvider.tsx';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConnectProvider>
      <App />
    </ConnectProvider>
  </React.StrictMode>,
)
