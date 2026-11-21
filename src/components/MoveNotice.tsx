import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPin } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { COLOR, FONT, RADIUS, TEXT, Z } from '../design/tokens';

/**
 * Обязательное сообщение о переезде (владелец 21.11.2026).
 *
 * Оба старых центра закрываются (Палиашвили — последний день 29.11,
 * Абусеридзе — 30.11), с 30.11 работает UNBOX 99 на Парнаваз Мепе. Люди
 * продолжали ставить брони в старые центры на декабрь, поэтому каждый, кто
 * открыл сайт под своим аккаунтом, один раз видит это окно и закрывает его
 * кнопкой «Понятно» — крестика и закрытия по фону нет.
 *
 * Отметка «прочитал» хранится на устройстве отдельно для каждого аккаунта.
 * После SHOW_UNTIL окно больше не показывается — переезд закончен.
 * Карты прохода пока не прикладываем: владелец пришлёт их ближе к концу ноября.
 */
const ACK_KEY = 'unbox_move_notice_2026_11';
const SHOW_UNTIL = '2026-12-15';
const VALENTINA_TG = 'HHValentinaHH';

function alreadySeen(userId: string): boolean {
    try {
        return localStorage.getItem(`${ACK_KEY}:${userId}`) === '1';
    } catch {
        return false; // хранилище недоступно — покажем, это не страшно
    }
}

function markSeen(userId: string): void {
    try {
        localStorage.setItem(`${ACK_KEY}:${userId}`, '1');
    } catch { /* приватный режим — окно появится снова при следующем входе */ }
}

export function MoveNotice() {
    const userId = useUserStore(s => s.currentUser?.id);
    // Кому уже закрыли окно в этой вкладке (отметка на устройстве — в alreadySeen).
    const [closedFor, setClosedFor] = useState<string | null>(null);
    const okRef = useRef<HTMLButtonElement>(null);

    const uid = userId ? String(userId) : '';
    const open = !!uid && closedFor !== uid
        && new Date().toISOString().slice(0, 10) <= SHOW_UNTIL
        && !alreadySeen(uid);

    useEffect(() => { if (open) okRef.current?.focus(); }, [open]);

    if (!open) return null;

    const close = () => { markSeen(uid); setClosedFor(uid); };

    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-notice-title"
            style={{
                position: 'fixed', inset: 0, zIndex: Z.dialog, display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 16, background: 'rgba(15,15,16,0.55)', fontFamily: FONT.sans,
            }}
        >
            <div
                style={{
                    width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', background: COLOR.card,
                    color: COLOR.ink, borderRadius: RADIUS.sheet, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span
                        aria-hidden="true"
                        style={{
                            width: 40, height: 40, borderRadius: 9999, display: 'inline-flex', alignItems: 'center',
                            justifyContent: 'center', background: COLOR.accentFill, color: '#fff', flexShrink: 0,
                        }}
                    >
                        <MapPin size={20} />
                    </span>
                    <h2 id="move-notice-title" style={{ fontSize: TEXT.title, fontWeight: 600, lineHeight: 1.2, margin: 0 }}>
                        Unbox переезжает
                    </h2>
                </div>

                <div style={{ fontSize: TEXT.body, lineHeight: 1.5, display: 'grid', gap: 10 }}>
                    <p style={{ margin: 0 }}>
                        С <b>30 ноября</b> мы работаем в новом центре <b>UNBOX 99</b>: Батуми, Парнаваз Мепе, 99.
                    </p>
                    <p style={{ margin: 0 }}>
                        Последний день на Палиашвили — 29 ноября, на Абусеридзе — 30 ноября.
                        На более поздние даты старые кабинеты уже не бронируются: выбирайте UNBOX 99.
                    </p>
                    <p style={{ margin: 0 }}>
                        По броням, которые уже стоят в старых центрах на декабрь, с вами свяжется
                        администратор Валентина.
                    </p>
                    <p style={{ margin: 0, color: COLOR.ink60 }}>
                        Подробности и схему прохода пришлём ближе к концу ноября.
                    </p>
                    <p style={{ margin: 0 }}>
                        Все вопросы о работе в новом центре — Валентине в Telegram:{' '}
                        <a
                            href={`https://t.me/${VALENTINA_TG}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: COLOR.accentInk, fontWeight: 600, textDecoration: 'underline' }}
                        >
                            @{VALENTINA_TG}
                        </a>
                    </p>
                </div>

                <button
                    ref={okRef}
                    type="button"
                    onClick={close}
                    style={{
                        marginTop: 20, width: '100%', minHeight: 48, border: 'none', borderRadius: RADIUS.control,
                        background: COLOR.accentFill, color: '#fff', fontSize: TEXT.body, fontWeight: 600,
                        fontFamily: FONT.sans, cursor: 'pointer',
                    }}
                >
                    Понятно
                </button>
            </div>
        </div>,
        document.body,
    );
}
