import React from 'react';
import { createRoot } from 'react-dom/client';
import { Toast } from '@heroui/react';
import { App } from './app/App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { toastQueue } from './components/toast-queue';
import { initTheme } from './utils/theme';
import { initWallpaper } from './utils/wallpaper';
import { initUserSelect } from './utils/userSelect';
import { initNavDepthReporting } from './shell/env';
import './styles/app.css';

initTheme();
initWallpaper();
initUserSelect();
// Before the router mounts: the host needs the history depth for back handling.
initNavDepthReporting();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Toast.Provider placement="top end" queue={toastQueue} />
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
