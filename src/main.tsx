import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

// StrictMode removed: MacroDistributionChart uses Chart.js which does not
// tolerate the double-mount/unmount cycle in development StrictMode.
// Chart cleanup is handled correctly in production.
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
