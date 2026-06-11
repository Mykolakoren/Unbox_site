import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ChevronRight, LogOut, Send, MessageCircle, MapPin, Phone, Briefcase, Gift, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../store/userStore';
import { api } from '../../api/client';
import { bonusesApi, type Bonus } from '../../api/bonuses';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import { getFavoriteCabinet, setFavoriteCabinet } from './favoriteCabinet';
import { resetTour } from './OnboardingTour';

const BOT_USERNAME = 'Unbox_Booking_G_Bot';
const ADMIN_TG = 'UnboxCenter';
const PHONE = '+995 599 324 668';
const TG_BLUE = '#229ED9';

const LOC_ADDRESSES = [
    { name: 'Unbox One', address: 'Палиашвили, 4, Батуми', mapsQuery: 'Unbox+One+Palaiashvili+4+Batumi' },
    { name: 'Unbox Uni', address: 'Тбел Абусеридзе, 38, Батуми', mapsQuery: 'Unbox+Uni+Tbel+Abuseridze+38+Batumi' },
];

export function MobileProfile() {
    const navigate = useNavigate();
    const { currentUser, logout, fetchCurrentUser } = useUserStore();
    const [tgBusy, setTgBusy] = useState(false);
    const [bonuses, setBonuses] = useState<Bonus[]>([]);
    const [favCab, setFavCab] = useState<string | null>(() => getFavoriteCabinet(currentUser?.id));

    useEffect(() => {
        // Load active bonuses (free-hour pool with FIFO expiry).
        // Best-effort — failure is non-blocking, the section just stays
        // hidden if the API errors.
        bonusesApi.getMyBonuses()
            .then(list => setBonuses(list.filter(b => b.status === 'active')))
            .catch(() => {});
    }, []);

    if (!currentUser) return null;

    const tgConnected = !!currentUser.telegramId && /^\d+$/.test(currentUser.telegramId);
    const isAdmin = currentUser.role === 'owner' || currentUser.role === 'senior_admin' || currentUser.role === 'admin' || currentUser.isAdmin;
    const isSpecialist = currentUser.role === 'specialist' || isAdmin;

    const balance = currentUser.balance ?? 0;
    const debt = balance < 0 ? -balance : 0;
    const sub = currentUser.subscription;

    const openInBot = () => {
        window.open(`https://t.me/${BOT_USERNAME}`, '_blank', 'noopener,noreferrer');
    };

    const connectTg = async () => {
        setTgBusy(true);
        try {
            const { data } = await api.post<{ url: string; expires_at: string }>('/telegram/link-token');
            window.open(data.url, '_blank', 'noopener,noreferrer');
            toast.info('В Telegram нажми «Start». Когда вернёшься сюда — потяни вниз для обновления.', { duration: 6000 });
            // 2026-06-02: было 90 сек — мало, юзеры не успевали кликнуть Start.
            // Совпадает с backend LINK_TOKEN_TTL = 30 минут.
            const deadline = Date.now() + 30 * 60 * 1000;
            const tick = setInterval(async () => {
                if (Date.now() > deadline) { clearInterval(tick); return; }
                await fetchCurrentUser();
                const cu = useUserStore.getState().currentUser;
                if (cu?.telegramId && /^\d+$/.test(cu.telegramId)) {
                    clearInterval(tick);
                    toast.success('Telegram подключён');
                }
            }, 2500);
        } catch {
            toast.error('Не удалось создать ссылку. Попробуй позже.');
        } finally {
            setTgBusy(false);
        }
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div style={{
            paddingTop: 12, paddingBottom: 24,
            display: 'flex', flexDirection: 'column', gap: 14,
        }}>
            {/* Compact identity — just name (and role if admin), one line */}
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.2 }}>
                    {currentUser.name}
                </h1>
                <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                    {currentUser.email}
                    {isAdmin && <span style={{ marginLeft: 8, color: '#0E0E0E', fontWeight: 600 }}>· {currentUser.role}</span>}
                </div>
            </div>

            {/* Wallet — balance + sub + debt in one card. Sub-card tappable to
                open full subscription page; profile card stays compact. */}
            <div style={{ padding: '0 16px' }}>
                <div style={{
                    background: '#F4F4F2',
                    borderRadius: 14,
                    padding: 14,
                    display: 'flex',
                    gap: 12,
                }}>
                    <Stat label="Баланс" value={`${balance.toFixed(0)} ₾`} tone={debt > 0 ? 'danger' : undefined} />
                    {sub && (
                        <button
                            onClick={() => window.location.assign('/m/subscription')}
                            style={{
                                flex: 1, padding: 0, margin: 0,
                                background: 'none', border: 'none',
                                cursor: 'pointer', textAlign: 'left',
                                fontFamily: 'inherit',
                            }}
                            aria-label="Открыть страницу абонемента"
                        >
                            <Stat label="Абонемент →" value={`${sub.remainingHours} ч`} sub={`/ ${sub.totalHours}`} />
                        </button>
                    )}
                    {debt > 0 && <Stat label="Долг" value={`${debt.toFixed(0)} ₾`} tone="danger" />}
                </div>
            </div>

            {/* Telegram bot — always Telegram blue */}
            <div style={{ padding: '0 16px' }}>
                <button
                    onClick={tgConnected ? openInBot : connectTg}
                    disabled={tgBusy}
                    style={{
                        width: '100%',
                        background: TG_BLUE,
                        color: '#fff',
                        border: 'none',
                        borderRadius: 12,
                        padding: '14px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        cursor: tgBusy ? 'wait' : 'pointer',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                        opacity: tgBusy ? 0.7 : 1,
                    }}
                >
                    <Send size={18} />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>
                            {tgConnected ? 'Открыть бота в Telegram' : 'Привязать Telegram'}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                            {tgConnected ? 'Уведомления и быстрые команды' : 'Получать напоминания за 24ч'}
                        </div>
                    </div>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>↗</span>
                </button>
            </div>

            {/* Bonuses — only show if any are active. Soonest-expiring first.
                Header is tappable: opens the full /m/bonuses page with
                active/used/expired filters and the audit history. */}
            {bonuses.length > 0 && (
                <div style={{ padding: '0 16px' }}>
                    <button
                        onClick={() => window.location.assign('/m/bonuses')}
                        style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', display: 'block', width: '100%', textAlign: 'left' }}
                        aria-label="Открыть страницу бонусов"
                    >
                        <SectionTitle>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <Gift size={12} /> Бонусы · {totalBonusHours(bonuses)} ч →
                            </span>
                        </SectionTitle>
                    </button>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {sortedBonuses(bonuses).slice(0, 5).map(b => {
                            const days = b.expiresAt ? daysUntil(b.expiresAt) : null;
                            const tone: 'urgent' | 'warn' | 'normal' = days != null
                                ? (days <= 7 ? 'urgent' : days <= 30 ? 'warn' : 'normal')
                                : 'normal';
                            return (
                                <div
                                    key={b.id}
                                    style={{
                                        background: '#fff',
                                        border: '1px solid rgba(0,0,0,0.08)',
                                        borderRadius: 12,
                                        padding: '10px 14px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                    }}
                                >
                                    <div style={{
                                        width: 28, height: 28,
                                        borderRadius: 8,
                                        background: tone === 'urgent' ? '#FEF2F2' : tone === 'warn' ? '#FEF3C7' : '#F4F4F2',
                                        color: tone === 'urgent' ? '#C8253A' : tone === 'warn' ? '#8A5A00' : '#0E0E0E',
                                        display: 'grid', placeItems: 'center',
                                        flexShrink: 0,
                                    }}>
                                        <Gift size={14} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>
                                            {b.quantity} ч {b.description ? `· ${b.description}` : ''}
                                        </div>
                                        {b.expiresAt && (
                                            <div style={{
                                                fontSize: 11,
                                                color: tone === 'urgent' ? '#C8253A' : tone === 'warn' ? '#8A5A00' : '#666',
                                                marginTop: 2,
                                            }}>
                                                {days == null
                                                    ? '—'
                                                    : days < 0
                                                        ? 'просрочен'
                                                        : days === 0
                                                            ? 'сгорает сегодня'
                                                            : days === 1
                                                                ? 'сгорает завтра'
                                                                : `осталось ${days} дн.`}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {bonuses.length > 5 && (
                            <div style={{ fontSize: 11, color: '#999', textAlign: 'center', marginTop: 4 }}>
                                и ещё {bonuses.length - 5}…
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Favourite cabinet — preselected as default in /m/find filters */}
            <div style={{ padding: '0 16px' }}>
                <SectionTitle>Любимый кабинет</SectionTitle>
                <select
                    value={favCab ?? ''}
                    onChange={e => {
                        const val = e.target.value || null;
                        setFavCab(val);
                        setFavoriteCabinet(currentUser.id, val);
                    }}
                    style={{
                        width: '100%',
                        background: '#fff',
                        border: '1px solid rgba(0,0,0,0.10)',
                        borderRadius: 12,
                        padding: '12px 14px',
                        fontSize: 16,
                        fontFamily: 'inherit',
                        color: '#0E0E0E',
                        appearance: 'none',
                        WebkitAppearance: 'none',
                    }}
                >
                    <option value="">— Без предпочтения —</option>
                    {RESOURCES
                        .filter(r => r.locationId !== 'neo_school' && r.isActive !== false)
                        .map(r => {
                            const loc = LOCATIONS.find(l => l.id === r.locationId);
                            return (
                                <option key={r.id} value={r.id}>
                                    {r.name}{loc ? ` · ${loc.name}` : ''}
                                </option>
                            );
                        })}
                </select>
                <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>
                    Будет подсвечен первым при поиске свободного слота.
                </div>
            </div>

            {/* Quick navigation: CRM (for specialists/admins), desktop, rules */}
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {isSpecialist && (
                    <NavRow
                        icon={<Briefcase size={16} />}
                        label="CRM (мобильный)"
                        sub="Клиенты, сессии, заметки"
                        onClick={() => navigate('/m/crm')}
                    />
                )}
                {isAdmin && (
                    <NavRow
                        icon={<Briefcase size={16} />}
                        label="Админка (мобильная)"
                        sub="Дашборд, юзеры, hot-booking заявки"
                        onClick={() => navigate('/m/admin')}
                    />
                )}
                <NavRow
                    icon={<HelpCircle size={16} />}
                    label="Показать обзор заново"
                    sub="30-секундный тур по кабинету для новичков"
                    onClick={() => {
                        resetTour(currentUser?.id);
                        // Reload `/m/today` with the force-tour flag so the
                        // tour fires immediately without waiting for a fresh
                        // session.
                        window.location.href = '/m/today?tour=1';
                    }}
                />
                {/* 2026-06-02 owner: убрана кнопка «Полный кабинет (десктоп)».
                    Юзеры путались — клик сохранял forceDesktop в session и
                    после следующего логина их снова кидало в десктоп-на-
                    мобиле. Теперь /m единственный интерфейс на телефоне.
                    Для отладки админам остался URL-параметр ?forceDesktop=1
                    на любой странице (см. App.tsx). */}
                <NavRow
                    icon={<ChevronRight size={16} />}
                    label="Наши центры"
                    sub="Кабинеты, фото, описания, цены"
                    onClick={() => navigate('/m/places')}
                />
                <NavRow
                    icon={<ChevronRight size={16} />}
                    label="Правила бронирования"
                    onClick={() => { window.location.href = '/m/booking-rules'; }}
                />
            </div>

            {/* Contacts */}
            <div style={{ padding: '0 16px' }}>
                <SectionTitle>Контакты Unbox</SectionTitle>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {LOC_ADDRESSES.map(loc => (
                        <a
                            key={loc.name}
                            href={`https://www.google.com/maps/search/?api=1&query=${loc.mapsQuery}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={contactRowStyle}
                        >
                            <MapPin size={16} color="#0E0E0E" />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, fontWeight: 700 }}>{loc.name}</div>
                                <div style={{ fontSize: 12, color: '#666', marginTop: 1 }}>{loc.address}</div>
                            </div>
                            <span style={{ fontSize: 11, color: '#999' }}>↗</span>
                        </a>
                    ))}
                    <a href={`tel:${PHONE.replace(/\s/g, '')}`} style={contactRowStyle}>
                        <Phone size={16} color="#0E0E0E" />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>{PHONE}</div>
                            <div style={{ fontSize: 12, color: '#666', marginTop: 1 }}>Звонок · WhatsApp</div>
                        </div>
                    </a>
                    <a
                        href={`https://t.me/${ADMIN_TG}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ ...contactRowStyle, background: TG_BLUE, color: '#fff', border: 'none' }}
                    >
                        <MessageCircle size={16} color="#fff" />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>Связь с администратором</div>
                            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>Telegram · @{ADMIN_TG}</div>
                        </div>
                        <span style={{ fontSize: 11, opacity: 0.85 }}>↗</span>
                    </a>
                </div>
            </div>

            {/* Logout */}
            <div style={{ padding: '0 16px', marginTop: 4 }}>
                <button
                    onClick={handleLogout}
                    style={{
                        width: '100%',
                        background: 'transparent',
                        color: '#C8253A',
                        border: 'none',
                        padding: '12px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 14,
                        fontWeight: 600,
                    }}
                >
                    <LogOut size={16} />
                    Выйти
                </button>
            </div>
        </div>
    );
}

const contactRowStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: 12,
    padding: '12px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    color: '#0E0E0E',
    textDecoration: 'none',
};

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: '#999',
            marginBottom: 8,
        }}>{children}</div>
    );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'danger' }) {
    return (
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: '#999', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>
                {label}
            </div>
            <div style={{
                fontSize: 17, fontWeight: 700,
                color: tone === 'danger' ? '#C8253A' : '#0E0E0E',
                marginTop: 2,
                lineHeight: 1.1,
            }}>
                {value}
                {sub && <span style={{ fontSize: 12, fontWeight: 500, color: '#999', marginLeft: 4 }}>{sub}</span>}
            </div>
        </div>
    );
}

function NavRow({ icon, label, sub, onClick }: {
    icon: React.ReactNode;
    label: string;
    sub?: string;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: '#0E0E0E',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                width: '100%',
            }}
        >
            <div style={{
                width: 28, height: 28,
                borderRadius: 8,
                background: '#F4F4F2',
                display: 'grid', placeItems: 'center',
                flexShrink: 0,
            }}>
                {icon}
            </div>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{label}</div>
                {sub && <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>{sub}</div>}
            </div>
            <ChevronRight size={16} color="#999" />
        </button>
    );
}


// ─── bonus helpers ─────────────────────────────────────────────────
function daysUntil(iso: string): number {
    const d = new Date(iso);
    const ms = d.getTime() - Date.now();
    return Math.ceil(ms / (24 * 3600 * 1000));
}

function totalBonusHours(bs: Bonus[]): number {
    return bs.reduce((s, b) => s + (b.quantity || 0), 0);
}

function sortedBonuses(bs: Bonus[]): Bonus[] {
    // Soonest-expiring first; bonuses without expiry sink to the bottom.
    return [...bs].sort((a, b) => {
        const ax = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
        const bx = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
        return ax - bx;
    });
}
