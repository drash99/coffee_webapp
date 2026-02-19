import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-[200px] flex flex-col items-center justify-center p-6 bg-white rounded-xl border border-red-200 text-center">
          <p className="text-red-700 font-medium mb-2">Something went wrong.</p>
          <p className="text-sm text-gray-600 mb-4">{this.state.error.message}</p>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
