import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { Button } from './ui';

/** Shown instead of a page that crashed while drawing, so the rest of the app keeps working. */
function CrashNotice() {
  const t = useT();
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
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    return this.state.failed ? <CrashNotice /> : this.props.children;
  }
}
