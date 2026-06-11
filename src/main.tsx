import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import * as Sentry from '@sentry/react'
import App from './App'
import './index.css'

// ── Sentry ──────────────────────────────────────────────────────────────────
// Opt-in: only runs when VITE_SENTRY_DSN is set at build time. Local dev and
// preview builds stay noise-free. On prod we catch uncaught exceptions +
// unhandled promise rejections. No user PII is sent — we leave the default
// beforeSend alone (no explicit user.email attached) and set sendDefaultPii=false.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (SENTRY_DSN) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.MODE,
        release: import.meta.env.VITE_RELEASE as string | undefined,
        sendDefaultPii: false,
        tracesSampleRate: 0,  // no performance tracing for now — just errors
        // Ignore noisy third-party errors we can't act on
        ignoreErrors: [
            'FedCM get() rejects',           // Google Sign-In (expected)
            'ResizeObserver loop',            // benign browser quirk
            'Failed to fetch dynamically imported module',  // we auto-reload in ModuleErrorBoundary
        ],
    });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
})

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "277953497231-ejqnao55sn2b8seegf3ckldg7704hdq3.apps.googleusercontent.com";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    // Forward to Sentry when enabled (no-op if init was skipped)
    Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
          <h1>Что-то пошло не так 😵</h1>
          <p>Приложение столкнулось с критической ошибкой.</p>
          <div style={{ background: '#fef2f2', border: '1px solid #ef4444', borderRadius: 8, padding: 16, marginTop: 16 }}>
            <h3 style={{ margin: '0 0 8px', color: '#b91c1c' }}>Текст ошибки:</h3>
            <code style={{ whiteSpace: 'pre-wrap', color: '#ef4444' }}>
              {this.state.error?.toString()}
            </code>
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, padding: '8px 16px', background: 'black', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Перезагрузить страницу
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// PWA service worker registration. Required for Chrome/Edge/Samsung Browser
// to install the mobile cabinet as a real WebAPK on Android (without it
// they fall back to a malformed shortcut that Play Protect flags). The SW
// itself does minimal work — see public/sw.js.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
            console.warn('SW registration failed:', err);
        });
    });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </GoogleOAuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
