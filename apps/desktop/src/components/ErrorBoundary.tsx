import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors in children and displays the error message
 * instead of unmounting the entire React tree.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.fallbackLabel ? ` ${this.props.fallbackLabel}` : ''}]`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 m-4 bg-red-950 border border-red-700 rounded-lg text-red-200 font-mono text-xs overflow-auto max-h-96">
          <p className="font-bold text-sm mb-2 text-red-400">
            {this.props.fallbackLabel ?? 'Component'} crashed
          </p>
          <p className="mb-2">{this.state.error.message}</p>
          <pre className="text-[10px] text-red-300 whitespace-pre-wrap">
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
