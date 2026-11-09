import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, X } from 'lucide-react';
import type { User } from '../../store/types';
import { COLOR, RADIUS, TEXT } from '../../design/tokens';
import { Button } from '../../components/ui/Button';

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
        // 09.11 фаза 3: спокойная карточка с бирюзовым значком вместо голубой
        // «статусной» плашки (синий в палитре — только «запланировано»).
        <div role="note" style={{
            background: COLOR.card, color: COLOR.ink,
            border: `1px solid ${COLOR.ink10}`,
            borderRadius: RADIUS.sheet, padding: '12px 16px',
            display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', width: '100%',
        }}>
            <Send size={20} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: COLOR.accentInk }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: TEXT.small, lineHeight: 1.45 }}>
                <div style={{ fontWeight: 600, fontSize: TEXT.body }}>Подключите Telegram</div>
                <div style={{ color: COLOR.ink60, marginTop: 2 }}>
                    {reason ?? 'Чтобы не пропустить подтверждение брони, напоминания и сообщение, если вашу пересдачу заберут.'}
                </div>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate('/m/profile')}
                    style={{ marginTop: 8 }}
                >
                    Подключить за минуту
                </Button>
            </div>
            {dismissible && (
                <button
                    type="button"
                    aria-label="Скрыть на неделю"
                    onClick={() => {
                        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* не страшно */ }
                        setHidden(true);
                    }}
                    style={{ width: 44, height: 44, margin: '-10px -10px 0 0', background: 'none', border: 'none', color: COLOR.ink60, cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}
                >
                    <X size={16} aria-hidden="true" />
                </button>
            )}
        </div>
    );
}
