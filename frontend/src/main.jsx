import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { SystemProvider } from './context/SystemContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <SystemProvider><ToastProvider><AuthProvider><App /></AuthProvider></ToastProvider></SystemProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
