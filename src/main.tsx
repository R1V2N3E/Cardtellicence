import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { requestPersistence, restoreAndMirror } from './storage';
import './styles.css';

// Restore data from the IndexedDB copy before the app reads localStorage, then ask the
// browser to keep this app's storage permanently.
restoreAndMirror()
  .catch(() => [])
  .finally(() => {
    void requestPersistence();
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    );
  });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
