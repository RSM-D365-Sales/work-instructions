import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Recover from a stale lazy-loaded chunk after a redeploy. If the tab still
// holds the previous index.html, a dynamic route import (e.g. Quality Trends)
// can 404 — "Failed to fetch dynamically imported module" — leaving a blank
// page. Re-fetching the same URL won't help (it's baked into the old build),
// so reload once to pull the fresh index.html + chunk hashes. A short time
// guard prevents a reload loop if the chunk is genuinely missing.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'vite-preload-reload-at';
  const last = Number(sessionStorage.getItem(KEY) || '0');
  if (Date.now() - last < 10_000) return; // just reloaded — let the error surface
  sessionStorage.setItem(KEY, String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
