import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { App } from './App';
import { I18nProvider } from '@/lib/i18n';
import { AuthProvider } from '@/hooks/useAuth';
import { applyBranding } from '@/lib/branding';
import { ThemeProvider } from '@/lib/theme';
import { initPwa } from '@/lib/pwa';
import { ErrorBoundary } from '@/components/ErrorBoundary';

applyBranding();
initPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <BrowserRouter>
            <ErrorBoundary fullScreen>
              <App />
            </ErrorBoundary>
          </BrowserRouter>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
