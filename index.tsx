
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { reportError } from './services/monitoring';

// 2.2-free: global safety net — unhandled errors/rejections reach the same
// reporting path as ErrorBoundary (console + Firestore now, Sentry when configured).
window.addEventListener('error', (event) => {
    reportError(event.error || event.message, { source: 'window.onerror' });
});
window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { source: 'unhandledrejection' });
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);