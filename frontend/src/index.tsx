import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/index.css';
import App from '@/App';
import { AuthProvider } from '@/context/AuthContext';
import { HRProvider } from '@/context/HRContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/sonner';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Élément root introuvable');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <HRProvider>
          <App />
          <Toaster position="top-right" richColors />
        </HRProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
