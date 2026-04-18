import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { I18nProvider } from './i18n/I18nProvider';
import { PublicSharedBrewApp } from './public/PublicSharedBrewApp';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <PublicSharedBrewApp />
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
