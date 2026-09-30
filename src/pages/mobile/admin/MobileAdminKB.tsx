import { useState } from 'react';
import { ChevronRight, BookOpen, Clock, Wallet, Sparkles, Sun, ListChecks } from 'lucide-react';
import { DesktopLink } from './DesktopLink';

type SectionId = 'pricing' | 'rules' | 'morning' | 'day' | 'evening';

interface Section {
    id: SectionId;
    title: string;
    sub: string;
    icon: React.ElementType;
}

const SECTIONS: Section[] = [
    { id: 'pricing', title: 'Тарифы и скидки',  sub: '20 ₾/ч инд., 35 ₾/ч груп., скидки за длительность',  icon: Wallet },
    { id: 'rules',   title: 'Правила бронирования', sub: 'Отмены, переносы, срочные брони, серии',        icon: BookOpen },
    { id: 'morning', title: 'Утренний чек-лист',    sub: 'Открытие центра — кабинеты, холл, кухня',         icon: Sun },
    { id: 'day',     title: 'Дневной чек-лист',     sub: 'Регулярные проверки в течение дня',               icon: Sparkles },
    { id: 'evening', title: 'Вечерний чек-лист',    sub: 'Закрытие центра — уборка, инвентарь, сейф',       icon: Clock },
];

/**
 * Mobile admin: База знаний — index of canonical operations docs. Content
 * itself stays on desktop (`/admin/knowledge-base`) where text + tables read
 * better; mobile shows the index so the on-call admin can quickly tap
 * "Утренний чек-лист" and read the short version.
 *
 * Wave 1: ссылка «Открыть полную статью →» вела на /admin/knowledge-base,
 * а телефон оттуда перенаправлял обратно на главную админки — тупик по
 * кругу (аудит G9-06). Теперь она идёт с ?forceDesktop=1 (DesktopLink) и
 * правда открывает полную статью.
 */
export function MobileAdminKB() {
    const [expandedId, setExpandedId] = useState<SectionId | null>(null);

    return (
        <div style={{ padding: '14px 14px 90px' }}>
            <div style={{
                fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: 'var(--color-ink-60)',
                marginBottom: 10,
            }}>
                База знаний · {SECTIONS.length} разделов
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SECTIONS.map(s => {
                    const Icon = s.icon;
                    const isOpen = expandedId === s.id;
                    return (
                        <div key={s.id}>
                            <button
                                onClick={() => setExpandedId(isOpen ? null : s.id)}
                                style={{
                                    width: '100%',
                                    background: 'var(--color-card)',
                                    border: '1px solid var(--color-ink-08)',
                                    borderRadius: 12,
                                    borderBottomLeftRadius: isOpen ? 0 : 12,
                                    borderBottomRightRadius: isOpen ? 0 : 12,
                                    padding: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    textAlign: 'left',
                                }}
                            >
                                <div style={{
                                    width: 36, height: 36, borderRadius: 9,
                                    background: 'var(--color-sunken)',
                                    color: 'var(--color-ink-80)',
                                    display: 'grid', placeItems: 'center',
                                    flexShrink: 0,
                                }}>
                                    <Icon size={16} aria-hidden="true" />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-ink)' }}>
                                        {s.title}
                                    </div>
                                    <div style={{
                                        fontSize: 12, color: 'var(--color-ink-60)',
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                        marginTop: 2,
                                    }}>
                                        {s.sub}
                                    </div>
                                </div>
                                <ChevronRight
                                    size={16}
                                    style={{
                                        color: 'var(--color-ink-60)',
                                        flexShrink: 0,
                                        transform: isOpen ? 'rotate(90deg)' : 'rotate(0)',
                                        transition: 'transform 200ms',
                                    }}
                                />
                            </button>
                            {isOpen && <SectionPreview section={s} />}
                        </div>
                    );
                })}
            </div>

            <div style={{
                marginTop: 16,
                padding: 12,
                background: 'var(--color-sunken)',
                borderRadius: 10,
                fontSize: 12,
                color: 'var(--color-ink-80)',
                lineHeight: 1.5,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
            }}>
                <ListChecks size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-ink-60)' }} />
                <span>
                    Здесь — короткие версии. Полные тексты и таблицы — в полной версии базы знаний.
                    <br />
                    <DesktopLink href="/admin/knowledge-base">Открыть базу знаний →</DesktopLink>
                </span>
            </div>
        </div>
    );
}

/** Inline preview block — short content snippet + подсказка, где полная статья. */
function SectionPreview({ section }: { section: Section }) {
    const snippet = (() => {
        switch (section.id) {
            case 'pricing':
                return 'Базовые тарифы: индивидуальный кабинет 20 ₾/ч, групповой 35 ₾/ч, капсула 10 ₾/ч. Скидки за длительность: 2 ч → −10%, 3 ч → −15%, 5+ ч → −20%. Пиковые часы (09–10, 20–22): +5 ₾/ч.';
            case 'rules':
                return 'Отмена бесплатно за 24 ч. Позже — оплата 100%, но бронь можно пересдать: если её кто-то заберёт, клиенту вернётся 50%. Серии: переносится «эта» или «эта и все следующие».';
            case 'morning':
                return '09:00 — открыть центр, проверить чистоту кабинетов, наполнить кулер, включить кондиционеры. Холл: смести крошки, перетряхнуть подушки. Кухня: помыть чашки.';
            case 'day':
                return 'Каждые 2–3 часа — обход кабинетов и холла. Проверить, что вода/чай/кофе в наличии. Уборка между сменами арендаторов.';
            case 'evening':
                return '21:30 — финальная уборка, выключить кондиционеры, проверить кабинеты на забытые вещи, закрыть окна, поставить на сигнализацию.';
            default:
                return '';
        }
    })();

    return (
        <div style={{
            background: 'var(--color-card)',
            border: '1px solid var(--color-ink-08)',
            borderTop: 'none',
            borderBottomLeftRadius: 12,
            borderBottomRightRadius: 12,
            padding: '12px 14px 14px',
            fontSize: 14,
            color: 'var(--color-ink-80)',
            lineHeight: 1.55,
        }}>
            <p style={{ margin: '0 0 4px' }}>{snippet}</p>
            <DesktopLink href="/admin/knowledge-base">Открыть полную статью →</DesktopLink>
        </div>
    );
}
