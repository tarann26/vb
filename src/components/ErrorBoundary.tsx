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
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F9F9F9] px-6 text-center">
        <h1 className="font-['Parisienne'] text-5xl text-[#222] mb-2">Via Bianca</h1>
        <p className="font-['Open_Sans'] text-gray-700 mb-6">
          Something went wrong loading this page.
        </p>
        <a
          href="/"
          className="bg-[#6B8B59] hover:bg-[#5a7349] text-white px-8 py-4 rounded-lg font-['Montserrat'] font-semibold uppercase tracking-wide"
        >
          Reload
        </a>
      </div>
    );
  }
}

export default ErrorBoundary;
