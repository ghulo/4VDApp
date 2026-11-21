import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startSelectionPills } from './components/ui/selectionPills'
import { startErrorTracking } from './errorTracking'
import { readLanguage, safeStorage } from './i18n/language'
import { loadCatalogue } from './i18n/useT'
import { startKeyboardInset } from './utils/keyboardInset'

// Start fetching the shown language's words now; the page waits for them (i18n/I18nProvider.tsx).
void loadCatalogue(readLanguage(safeStorage(), navigator.languages ?? [navigator.language])).catch(() => undefined)
startSelectionPills()
startErrorTracking()
startKeyboardInset()

// Pages load on demand. After a new release, a tab left open may ask for page files
// that no longer exist, so reload once to pick up the new release instead of failing.
// Without internet a reload only shows the browser's "No internet" page: the error goes
// on to the page's notice instead, which offers Try again (components/ErrorBoundary.tsx).
window.addEventListener('vite:preloadError', (event) => {
  if (!navigator.onLine) return
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

// The saved copy of 4VD on this device (public/sw.js), so it opens without internet (the Counter at the shop sells from it).
// Registered on every load, alerts or not; the same worker shows the alerts. Only the built app has a copy to save.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
