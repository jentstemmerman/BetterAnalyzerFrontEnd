import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './overlayPatch.css';
import App from './App';
import ErrorBoundary from './ErrorBoundary';

// Global error instrumentation to expand opaque [object Object] runtime errors
if (process.env.NODE_ENV === 'development') {
  const seen = new WeakSet();
  const safeSerialize = (obj) => {
    if (!obj || typeof obj !== 'object') return String(obj);
    try {
      return JSON.stringify(obj, function(key, value) {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        if (value instanceof Error) {
          return { name: value.name, message: value.message, stack: value.stack };
        }
        return value;
      });
    } catch (e) {
      return '[Unserializable Object] ' + (e && e.message);
    }
  };
  window.addEventListener('error', (e) => {
    console.group('%cGlobal Error','color:red;font-weight:bold');
    console.error(e.message, e.error);
    if (e.error) console.log('Serialized:', safeSerialize(e.error));
    console.groupEnd();
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r && (r.type === 'cancelation' || r.name === 'Canceled' || r.message === 'Canceled')) {
      // Monaco often cancels async ops; silence these fully (prevent overlay)
      e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      // eslint-disable-next-line no-console
      console.debug('[silenced] Monaco cancellation promise rejection');
      return;
    }
    console.group('%cUnhandled Promise Rejection','color:orangered;font-weight:bold');
    console.error(r);
    console.log('Serialized:', safeSerialize(r));
    console.groupEnd();
  });

  // Periodically remove overlay if it's only showing a Monaco cancellation message
  const cancelOverlayFilter = () => {
    const overlay = document.getElementById('webpack-dev-server-client-overlay');
    if (!overlay) return;
    const txt = overlay.textContent || '';
    if (/operation is manually canceled|cancelation/i.test(txt) && txt.length < 500) {
      overlay.remove();
      // eslint-disable-next-line no-console
      console.debug('[overlay] removed benign cancellation overlay');
    }
  };
  const overlayInterval = setInterval(cancelOverlayFilter, 600);
  window.addEventListener('beforeunload', () => clearInterval(overlayInterval));
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
