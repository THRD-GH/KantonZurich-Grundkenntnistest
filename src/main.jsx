import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { CF_BEACON_TOKEN } from './analytics'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Cloudflare Web Analytics — cookieless, privacy-friendly visit counts. Loads only in production
// and only when a token is configured (see src/analytics.js). Sets no cookies, no personal data.
if (import.meta.env.PROD && CF_BEACON_TOKEN) {
  const s = document.createElement('script')
  s.defer = true
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js'
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_BEACON_TOKEN }))
  document.head.appendChild(s)
}

// Register the service worker for offline use (production builds only — avoids caching during dev)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const base = import.meta.env.BASE_URL; // "/" or "/<repo>/"
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch(() => {});
  });
}
