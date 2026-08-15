import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean }

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    // The strings below are hardcoded, not read from copy.errorBoundary, on
    // purpose: main.tsx evaluates the whole static import graph (App and
    // everything it imports, including content/index.ts's guards) before
    // createRoot() ever runs, so a throw there happens before any render --
    // an ErrorBoundary that itself imported content would fail to load
    // right along with it, losing the one fallback meant to survive that.
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-cream-alt px-6 text-center">
        <h1 className="font-['Parisienne'] text-5xl text-ink mb-2">Via Bianca</h1>
        <p className="font-['Open_Sans'] text-gray-700 mb-6">
          Something went wrong loading this page.
        </p>
        <a
          href="/"
          className="bg-brand hover:bg-brand-dark text-ink px-8 py-4 rounded-lg font-['Montserrat'] font-semibold uppercase tracking-wide"
        >
          Reload
        </a>
      </div>
    );
  }
}

export default ErrorBoundary;
