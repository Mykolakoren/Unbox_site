import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Copy } from 'lucide-react';

interface Props {
  children: ReactNode;
  moduleName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class ModuleErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  componentDidMount() {
    // If we got here, the children rendered successfully → drop the
    // chunk-retry flag so a future deploy can auto-recover too. Without
    // this the flag stays in sessionStorage forever and a second
    // stale-bundle event on the same path silently shows the error
    // screen instead of reloading.
    try {
      sessionStorage.removeItem(`unbox_chunk_retry_${window.location.pathname}`);
    } catch { /* private mode / disabled storage */ }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[${this.props.moduleName || 'Module'}] Error:`, error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack ?? null });

    // ── Stale-tab auto-recovery ──
    // When we ship a new bundle, rsync --delete removes the old chunks. Any
    // tab opened before the deploy still has the previous index.js with
    // references to those now-gone chunk filenames. The first lazy import
    // (e.g. clicking on /crm) then fails with "Failed to fetch dynamically
    // imported module". We detect that shape of error and force-reload
    // with a cache-busting query so iOS Safari can't serve the stale
    // index.html out of bfcache.
    const msg = (error?.message || '').toLowerCase();
    const isChunkLoad =
      msg.includes('failed to fetch dynamically imported module') ||
      msg.includes('loading chunk') ||
      msg.includes('importing a module script failed') ||
      (error as any)?.name === 'ChunkLoadError';

    if (isChunkLoad) {
      // Guard against an infinite loop: only reload once per URL.
      const flag = `unbox_chunk_retry_${window.location.pathname}`;
      if (!sessionStorage.getItem(flag)) {
        sessionStorage.setItem(flag, '1');
        // Small timeout so the state update above has a chance to flush.
        setTimeout(() => {
          // Cache-bust: changing the URL forces Safari/iOS off bfcache
          // and off the disk cache for the HTML document, which then
          // pulls the fresh <script src="index-<NEW_HASH>.js">.
          const url = new URL(window.location.href);
          url.searchParams.set('_cb', String(Date.now()));
          window.location.replace(url.toString());
        }, 250);
      }
    }
  }

  handleCopy = () => {
    const text = [
      `Module: ${this.props.moduleName || 'Unknown'}`,
      `Message: ${this.state.error?.message || 'N/A'}`,
      '',
      '--- Error Stack ---',
      this.state.error?.stack || 'N/A',
      '',
      '--- Component Stack ---',
      this.state.componentStack || 'N/A',
    ].join('\n');
    try {
      navigator.clipboard?.writeText(text);
    } catch {
      /* noop */
    }
  };

  render() {
    if (this.state.hasError) {
      const stack = this.state.error?.stack || '';
      const componentStack = this.state.componentStack || '';
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-6">
          <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2 text-center">
            {this.props.moduleName ? `Ошибка в модуле «${this.props.moduleName}»` : 'Произошла ошибка'}
          </h3>
          <p className="text-sm text-gray-700 mb-4 max-w-xl text-center font-medium">
            {this.state.error?.message || 'Неизвестная ошибка'}
          </p>
          {(stack || componentStack) && (
            <details className="w-full max-w-3xl mb-4 text-left">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700 select-none mb-2">
                Показать стек (для отладки)
              </summary>
              <pre className="text-[10px] leading-snug bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap break-all">
                {stack}
                {componentStack && '\n\n--- Component Stack ---' + componentStack}
              </pre>
            </details>
          )}
          <div className="flex gap-2 flex-wrap justify-center">
            <button
              onClick={() => {
                // Clear the chunk-retry flag so the next stale-bundle
                // event can auto-reload again.
                try {
                  sessionStorage.removeItem(`unbox_chunk_retry_${window.location.pathname}`);
                } catch { /* noop */ }
                this.setState({ hasError: false, error: null, componentStack: null });
              }}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Попробовать снова
            </button>
            <button
              onClick={this.handleCopy}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              <Copy className="w-4 h-4" />
              Скопировать ошибку
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
