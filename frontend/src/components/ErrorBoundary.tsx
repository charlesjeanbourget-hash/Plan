import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-8" data-testid="error-boundary">
          <div className="max-w-md text-left">
            <p className="text-xs uppercase tracking-[0.2em] text-orange-600 font-semibold mb-3">Erreur</p>
            <h1 className="text-3xl font-bold text-slate-900 mb-3 font-heading">Une erreur est survenue</h1>
            <p className="text-slate-600 mb-6 text-sm">{this.state.message}</p>
            <button
              data-testid="error-reload-button"
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-emerald-600 text-white rounded-full font-semibold text-sm hover:bg-emerald-700 transition-colors"
            >
              Recharger l'application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
