import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('UI error', error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-24 max-w-md rounded-lg border border-red-200 bg-white p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-500" aria-hidden />
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-slate-500">The page hit an unexpected error. Your data is safe. Try reloading.</p>
        <div className="mt-4 flex justify-center gap-2"><button className="btn-primary" onClick={() => window.location.reload()}>Reload</button><a className="btn-secondary" href="/">Go to dashboard</a></div>
      </div>
    );
  }
}
