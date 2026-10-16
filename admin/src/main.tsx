import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startSelectionPills } from './components/ui/selectionPills'

startSelectionPills()

// Pages load on demand. After a new release, a tab left open may ask for page files
// that no longer exist, so reload once to pick up the new release instead of failing.
window.addEventListener('vite:preloadError', (event) => {
  const key = '4vd:reloaded-for-release'
  try {
    const last = Number(sessionStorage.getItem(key) ?? 0)
    if (Date.now() - last < 10_000) return
    sessionStorage.setItem(key, String(Date.now()))
  } catch {
    // No storage: still worth one reload.
  }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
