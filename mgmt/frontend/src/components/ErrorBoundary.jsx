import React from 'react';
import { reportClientError } from '../api.js';
import { isChunkLoadError, reloadOnceForChunkError } from '../chunkGuard.js';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, showDetails: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    if (reloadOnceForChunkError(error)) return;
    reportClientError(
      this.props.name || 'ErrorBoundary',
      'React render crashed',
      error,
      { componentStack: (info && info.componentStack ? info.componentStack : '').slice(0, 800) }
    );
  }

  isChunkLoadError() {
    return isChunkLoadError(this.state.error);
  }

  render() {
    const { error, showDetails, info } = this.state;
    if (!error) return this.props.children;

    if (this.isChunkLoadError()) {
      return (
        <div className="glass-card" style={{ padding: 20, textAlign: 'center', margin: 15 }}>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>The app has been updated</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            A new version was deployed, so this page could not load. Please refresh the page.
          </p>
          <button className="btn-submit" style={{ width: 'auto' }} onClick={() => window.location.reload()}>
            🔄 Refresh
          </button>
        </div>
      );
    }

    return (
      <div className="glass-card" style={{ padding: 20, margin: 15 }}>
        <p style={{ fontWeight: 600, marginBottom: 8 }}>Something went wrong</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          An error occurred on this screen. It has been recorded automatically in the Error Log —
          a Superadmin can review it. You can switch to another tab or refresh the page.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-submit" style={{ width: 'auto' }} onClick={() => window.location.reload()}>
            🔄 Refresh
          </button>
          <button
            type="button"
            className="btn-submit"
            style={{ width: 'auto', background: '#e5e7eb', color: '#111' }}
            onClick={() => this.setState({ showDetails: !showDetails })}
          >
            {showDetails ? 'Hide details' : 'Technical details'}
          </button>
        </div>
        {showDetails && (
          <pre
            style={{
              marginTop: 12, background: '#f9fafb', border: '1px solid #eee', borderRadius: 8,
              padding: 10, fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 220, overflowY: 'auto',
            }}
          >
            {error.message}
            {'\n\n'}
            {(error.stack || '').slice(0, 1500)}
            {info && info.componentStack ? '\n\nComponent stack:' + info.componentStack.slice(0, 800) : ''}
          </pre>
        )}
      </div>
    );
  }
}
