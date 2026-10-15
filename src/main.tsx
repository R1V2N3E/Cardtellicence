import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { requestPersistence, restoreAndMirror } from './storage';
import './styles.css';

// Restore data from the IndexedDB copy before the app reads localStorage, then ask the
// browser to keep this app's storage permanently.
function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
}

// Restore data from the IndexedDB copy, but never wait more than a moment for it: on some
// iPhones IndexedDB doesn't answer, and the app must start anyway.
let started = false;
const start = () => {
  if (started) return;
  started = true;
  render();
};
setTimeout(start, 800);
restoreAndMirror()
  .then((restored) => {
    if (!started) return start();
    // Restored after the app started: tell the screens to reload these keys.
    for (const key of restored) window.dispatchEvent(new CustomEvent('ct-storage', { detail: key }));
  })
  .catch(start)
  .finally(() => {
    start();
    void requestPersistence();
  });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
