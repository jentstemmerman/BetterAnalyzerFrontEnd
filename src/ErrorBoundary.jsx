import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    const details = { name: error?.name, message: error?.message, stack: error?.stack, keys: Object.keys(error || {}) };
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Caught error', details, info);
    this.setState({ info });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '1rem', fontFamily: 'monospace', color: '#b00020' }}>
          <h2>Runtime Error</h2>
          <pre>{JSON.stringify({ message: this.state.error?.message, keys: Object.keys(this.state.error || {}) }, null, 2)}</pre>
          <button onClick={() => this.setState({ hasError: false, error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
