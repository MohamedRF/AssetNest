import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string | null;
}

/**
 * Top-level error boundary. Logs details to the console for diagnostics and
 * shows a calm fallback — never a blank screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('AssetNest: unhandled render error', error, info.componentStack);
  }

  private readonly handleReload = () => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-subtle">
          <TriangleAlert aria-hidden="true" className="h-7 w-7 text-danger" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          AssetNest hit an unexpected error. Reloading usually fixes it — if it keeps happening, contact your
          workspace administrator.
        </p>
        {this.state.message !== null && (
          <p className="max-w-md rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
            {this.state.message}
          </p>
        )}
        <button
          type="button"
          onClick={this.handleReload}
          className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:bg-accent-hover"
        >
          Reload AssetNest
        </button>
      </div>
    );
  }
}
