import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { installGlobalHandlers } from './lib/errorLogger';
import { installStaleBundleReload } from './lib/staleBundleReload';

installGlobalHandlers();
// A tab open across a deploy reloads itself the first time a lazy chunk from
// the old build is missing, instead of running stale code indefinitely.
installStaleBundleReload();

// StrictMode removed: MacroDistributionChart uses Chart.js which does not
// tolerate the double-mount/unmount cycle in development StrictMode.
// Chart cleanup is handled correctly in production.
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
