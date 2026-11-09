import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, X } from 'lucide-react';
import type { User } from '../../store/types';
import { COLOR, RADIUS, STATUS, TEXT } from '../../design/tokens';

const DISMISS_KEY = 'unbox.m.tgCardDismissedAt';
const DISMISS_DAYS = 7;

/** Подключён ли бот: telegramId — числовой chat id (как в профиле). */
export function isTelegramLinked(u: Pick<User, 'telegramId'> | null | undefined): boolean {
    return !!u?.telegramId && /^\d+$/.test(String(u.telegramId));
}

function dismissedRecently(): boolean {
    try {
        const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
        return at > 0 && Date.now() - at < DISMISS_DAYS * 86400000;
    } catch { return false; }
}

/**
 * «Подключите Telegram» (ревью клиентской части 09.11, №9): подтверждение
 * срочной брони, напоминания и «вашу пересдачу забрали» приходят в Telegram.
 * Карточка на «Сегодня» и на экране «Бронь ваша», пока бот не подключён.
 * На «Сегодня» её можно скрыть на неделю; после брони (force) — всегда видна.
 * Подключение — в «Профиле» (там уже есть привязка бота).
 */
export function TelegramConnectCard({ user, reason, dismissible = true }: {
    user: User | null | undefined;
    /** Почему это важно именно сейчас. */
    reason?: string;
    dismissible?: boolean;
}) {
    const navigate = useNavigate();
    const [hidden, setHidden] = useState(() => dismissible && dismissedRecently());
    if (!user || isTelegramLinked(user) || hidden) return null;
    return (
        <div role="note" style={{
            background: STATUS.info.bg, color: STATUS.info.fg,
            borderRadius: RADIUS.sheet, padding: '12px 14px',
            display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', width: '100%',
        }}>
            <Send size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: TEXT.small, lineHeight: 1.45 }}>
                <div style={{ fontWeight: 600 }}>Подключите Telegram</div>
                <div style={{ color: COLOR.ink80 }}>
                    {reason ?? 'Чтобы не пропустить подтверждение брони, напоминания и сообщение, если вашу пересдачу заберут.'}
                </div>
                <button
                    type="button"
                    onClick={() => navigate('/m/profile')}
                    style={{
                        marginTop: 6, minHeight: 44, padding: 0, background: 'none', border: 'none',
                        color: STATUS.info.fg, fontWeight: 600, fontSize: TEXT.small, fontFamily: 'inherit',
                        textDecoration: 'underline', cursor: 'pointer',
                    }}
                >
                    Подключить за минуту
                </button>
            </div>
            {dismissible && (
                <button
                    type="button"
                    aria-label="Скрыть на неделю"
                    onClick={() => {
                        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* не страшно */ }
                        setHidden(true);
                    }}
                    style={{ width: 44, height: 44, margin: '-10px -10px 0 0', background: 'none', border: 'none', color: STATUS.info.fg, cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}
                >
                    <X size={16} aria-hidden="true" />
                </button>
            )}
        </div>
    );
}
