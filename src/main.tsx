import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
})

const GOOGLE_CLIENT_ID = "737163019349-24utj0eaemakjvr1ve8lpfgdno2q4tfr.apps.googleusercontent.com";

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
