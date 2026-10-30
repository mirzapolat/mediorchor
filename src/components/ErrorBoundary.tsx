import { Component, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { LoadError } from '@/components/LoadError';
import { track } from '@/lib/analytics';

// A lazily loaded part of the app (or a request) could not be fetched. The
// wording differs per browser: Chrome, Safari, Firefox.
const isNetworkError = (error: unknown) =>
  !navigator.onLine ||
  (error instanceof Error &&
    /dynamically imported module|Importing a module script failed|Failed to fetch|Load failed|NetworkError/i.test(
      error.message,
    ));

// A failed module import stays failed until the page loads again, so "try
// again" is a reload (offline, the service worker answers with the app).
const reload = () => window.location.reload();

interface Props {
  children: ReactNode;
  fullScreen?: boolean;
  // A new value (the next page) clears the error.
  resetKey: string;
}

class Boundary extends Component<Props, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    track('app-load-error', { network: isNetworkError(error) });
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <LoadError network={isNetworkError(this.state.error)} onRetry={reload} fullScreen={this.props.fullScreen} />;
  }
}

// Instead of a blank screen when a page fails to load or render: the
// LoadError page, until the user goes elsewhere or tries again.
export const ErrorBoundary = ({ children, fullScreen }: { children: ReactNode; fullScreen?: boolean }) => {
  const { pathname } = useLocation();
  return (
    <Boundary resetKey={pathname} fullScreen={fullScreen}>
      {children}
    </Boundary>
  );
};
