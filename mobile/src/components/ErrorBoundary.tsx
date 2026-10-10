import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ui';

/**
 * Catches a rendering bug so the app shows a way back instead of a blank screen.
 * "Try again" draws everything again from scratch.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    // The raw message is for developers (logged above); staff see the plain one.
    return <ErrorState error={null} onRetry={() => this.setState({ error: null })} />;
  }
}
