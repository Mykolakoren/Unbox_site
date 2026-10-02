import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Copy, MessageCircle } from 'lucide-react';
import { Button } from './Button';
import { FONT, STATUS } from '../../design/tokens';
import { useUserStore } from '../../store/userStore';
import { isChunkLoadError, reloadOnceForStaleBundle } from '../../utils/chunkRecovery';

/** Куда писать, если экран упал (тот же Telegram, что в SpecialistGate). */
const ADMIN_CONTACT_URL = 'https://t.me/UnboxCenter';

/** Админ/владелец — им показываем текст ошибки и стек (волна 2, X3-09). */
function isStaffViewer(): boolean {
  try {
    const u = useUserStore.getState().currentUser as { role?: string | null; isAdmin?: boolean | null } | null;
    return !!u && (u.role === 'owner' || u.role === 'senior_admin' || u.role === 'admin' || !!u.isAdmin);
  } catch {
    return false;
  }
}

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

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[${this.props.moduleName || 'Module'}] Error:`, error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack ?? null });

    // ── Stale-tab auto-recovery ──
    // После выкладки старые чанки пропадают с сервера, а вкладка, открытая до
    // выкладки, всё ещё ссылается на них (Chrome: «Failed to fetch dynamically
    // imported module», Firefox: «error loading dynamically imported module»).
    // Узнаём такую ошибку и один раз перезагружаем страницу с cache-bust
    // параметром — формулировки и защита от цикла в utils/chunkRecovery.
    if (isChunkLoadError(error)) reloadOnceForStaleBundle();
  }

  handleReload = () => {
    window.location.reload();
  };

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
      // Техподробности (текст ошибки, стек, копирование) — только в dev и
      // админам: клиенту они ничего не говорят и пугают (X3-09).
      const showDetails = import.meta.env.DEV || isStaffViewer();
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center min-h-[300px] p-6 bg-paper text-ink"
          style={{ fontFamily: FONT.sans }}
        >
          <AlertTriangle className="w-10 h-10 mb-4" style={{ color: STATUS.pending.fg }} aria-hidden="true" />
          <h2 className="text-title font-semibold mb-2 text-center">Этот экран не загрузился</h2>
          <p className="text-body text-ink-60 mb-6 max-w-md text-center">
            Обновите страницу — обычно это помогает. Если не помогло, напишите администратору.
          </p>
          <div className="flex gap-2 flex-wrap justify-center">
            <Button icon={<RotateCcw size={18} aria-hidden="true" />} onClick={this.handleReload}>
              Обновить страницу
            </Button>
            <a
              href={ADMIN_CONTACT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-btn ui-btn--secondary"
            >
              <MessageCircle size={18} aria-hidden="true" />
              Написать администратору
            </a>
          </div>
          {showDetails && (
            <details className="w-full max-w-3xl mt-6 text-left">
              <summary className="cursor-pointer text-caption text-ink-60 select-none mb-2">
                Для администратора: {this.props.moduleName ? `раздел «${this.props.moduleName}», ` : ''}
                {this.state.error?.message || 'без текста ошибки'}
              </summary>
              {(stack || componentStack) && (
                <pre
                  className="text-caption leading-snug bg-sunken border border-ink-10 p-3 overflow-auto max-h-64 whitespace-pre-wrap break-all mb-2"
                  style={{ fontFamily: FONT.mono }}
                >
                  {stack}
                  {componentStack && '\n\n--- Component Stack ---' + componentStack}
                </pre>
              )}
              <Button variant="quiet" size="compact" icon={<Copy size={16} aria-hidden="true" />} onClick={this.handleCopy}>
                Скопировать ошибку
              </Button>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
