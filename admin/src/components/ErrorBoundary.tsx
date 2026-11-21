import { Component, type ErrorInfo, type ReactNode, useState } from 'react';
import { reportError } from '../errorTracking';
import { useT } from '../i18n/useT';
import { offlineLoadError } from '../utils/offlineLoad';
import { Button } from './ui';

/**
 * Shown instead of a page that crashed while drawing, so the rest of the app
 * keeps working. A page that couldn't load for want of internet says so and
 * waits for it, instead of reloading into the browser's "No internet" page.
 */
export function CrashNotice({ error }: { error?: unknown }) {
  const t = useT();
  const [still, setStill] = useState(false);
  if (offlineLoadError(error)) {
    return (
      <div className="notice notice--warn" role="alert">
        <p>{still ? t.common.stillOffline : t.common.offlinePage}</p>
        <Button size="sm" onClick={() => (navigator.onLine ? window.location.reload() : setStill(true))}>
          {t.common.tryAgain}
        </Button>
      </div>
    );
  }
  return (
    <div className="notice notice--error" role="alert">
      <p>{t.common.crashed}</p>
      <Button size="sm" onClick={() => window.location.reload()}>
        {t.common.reload}
      </Button>
    </div>
  );
}

/** Catches a page's rendering bug. Give it a key that changes on navigation to clear it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown; failed: boolean }> {
  state = { error: undefined as unknown, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    // No internet isn't a bug worth a report.
    if (!offlineLoadError(error)) reportError(error);
  }

  render() {
    return this.state.failed ? <CrashNotice error={this.state.error} /> : this.props.children;
  }
}
