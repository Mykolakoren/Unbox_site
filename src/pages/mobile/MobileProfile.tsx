import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowUpRight, ChevronRight, ClipboardCheck, LogOut, Send, MessageCircle, MapPin, Phone, Briefcase, Gift, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../store/userStore';
import { api } from '../../api/client';
import { bonusesApi, type Bonus } from '../../api/bonuses';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import { getFavoriteCabinet, setFavoriteCabinet } from './favoriteCabinet';
import { reservedSubscriptionHours } from '../../utils/paymentPriority';
import { resetTour } from './OnboardingTour';
import { canBookCabinets } from '../../utils/permissions';
import { COLOR, STATUS } from '../../design/tokens';
import { formatGel } from '../../utils/format';

const BOT_USERNAME = 'Unbox_Booking_G_Bot';
const ADMIN_TG = 'UnboxCenter';
const PHONE = '+995 599 324 668';
// Wave 1: фирменный голубой Telegram убран — белое на #229ED9 давало 2.9:1,
// а цвет в продукте только для статуса. Строки Telegram — как остальные.

const LOC_ADDRESSES = [
    { name: 'Unbox One', address: 'Палиашвили, 4, Батуми', mapsQuery: 'Unbox+One+Palaiashvili+4+Batumi' },
    { name: 'Unbox Uni', address: 'Тбел Абусеридзе, 38, Батуми', mapsQuery: 'Unbox+Uni+Tbel+Abuseridze+38+Batumi' },
];

export function MobileProfile() {
    const navigate = useNavigate();
    const { currentUser, logout, fetchCurrentUser, bookings } = useUserStore();
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
    // Часы будущих, ещё не списанных броней «с абонемента» уже обещаны —
    // без них «осталось 6 ч» обманывало (G4-client-mobile-M1).
    const subReserved = reservedSubscriptionHours(sub, bookings, currentUser.email);

    const openInBot = () => {
        window.open(`https://t.me/${BOT_USERNAME}`, '_blank', 'noopener,noreferrer');
    };

    const connectTg = async () => {
        setTgBusy(true);
        try {
            const { data } = await api.post<{ url: string; expires_at: string }>('/telegram/link-token');
            window.open(data.url, '_blank', 'noopener,noreferrer');
            toast.info('В Telegram нажмите «Start», затем вернитесь сюда — статус обновится сам.', { duration: 6000 });
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
            toast.error('Не удалось создать ссылку. Попробуйте позже.');
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
                <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.2 }}>
                    {currentUser.name}
                </h1>
                <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 2 }}>
                    {currentUser.email}
                    {isAdmin && <span style={{ marginLeft: 8, color: COLOR.ink, fontWeight: 600 }}>· {currentUser.role}</span>}
                </div>
            </div>

            {/* Wallet — balance + sub + debt in one card. Sub-card tappable to
                open full subscription page; profile card stays compact. */}
            <div style={{ padding: '0 16px' }}>
                <div style={{
                    background: COLOR.sunken,
                    borderRadius: 14,
                    padding: 14,
                    display: 'flex',
                    gap: 12,
                }}>
                    <Stat label="Баланс" value={formatGel(balance, { fraction: 0 })} tone={debt > 0 ? 'danger' : undefined} />
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
                            <Stat
                                label="Абонемент →"
                                value={`${sub.remainingHours} ч`}
                                sub={subReserved > 0.01
                                    ? `/ ${sub.totalHours} · ${Number(subReserved.toFixed(1))} в бронях`
                                    : `/ ${sub.totalHours}`}
                            />
                        </button>
                    )}
                    {debt > 0 && <Stat label="Долг" value={formatGel(debt, { fraction: 0 })} tone="danger" />}
                </div>
            </div>

            {/* Telegram bot */}
            <div style={{ padding: '0 16px' }}>
                <button
                    onClick={tgConnected ? openInBot : connectTg}
                    disabled={tgBusy}
                    style={{
                        width: '100%',
                        background: COLOR.card,
                        color: COLOR.ink,
                        border: `1px solid ${COLOR.ink10}`,
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
                    <Send size={18} aria-hidden="true" />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                            {tgConnected ? 'Открыть бота в Telegram' : 'Привязать Telegram'}
                        </div>
                        <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 2 }}>
                            {tgConnected ? 'Уведомления и быстрые команды' : 'Получать напоминания за 24 ч'}
                        </div>
                    </div>
                    <ArrowUpRight size={16} color={COLOR.ink60} aria-hidden="true" />
                </button>
            </div>

            {/* Bonuses — only show if any are active. Soonest-expiring first.
                Header is tappable: opens the full /m/bonuses page with
                active/used/expired filters and the audit history. */}
            {bonuses.length > 0 && (
                <div style={{ padding: '0 16px' }}>
                    <button
                        onClick={() => window.location.assign('/m/bonuses')}
                        style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', minHeight: 44, width: '100%', textAlign: 'left', fontFamily: 'inherit' }}
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
                                        background: COLOR.card,
                                        border: `1px solid ${COLOR.ink08}`,
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
                                        background: tone === 'urgent' ? STATUS.danger.bg : tone === 'warn' ? STATUS.pending.bg : COLOR.sunken,
                                        color: tone === 'urgent' ? STATUS.danger.fg : tone === 'warn' ? STATUS.pending.fg : COLOR.ink,
                                        display: 'grid', placeItems: 'center',
                                        flexShrink: 0,
                                    }}>
                                        <Gift size={14} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>
                                            {b.quantity} ч {b.description ? `· ${b.description}` : ''}
                                        </div>
                                        {b.expiresAt && (
                                            <div style={{
                                                fontSize: 12,
                                                color: tone === 'urgent' ? STATUS.danger.fg : tone === 'warn' ? STATUS.pending.fg : COLOR.ink60,
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
                            <div style={{ fontSize: 12, color: COLOR.ink60, textAlign: 'center', marginTop: 4 }}>
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
                        background: COLOR.card,
                        border: `1px solid ${COLOR.ink10}`,
                        borderRadius: 12,
                        padding: '12px 14px',
                        fontSize: 16,
                        fontFamily: 'inherit',
                        color: COLOR.ink,
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
                <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 6 }}>
                    Будет подсвечен первым при поиске свободного слота.
                </div>
            </div>

            {/* Quick navigation: CRM (for specialists/admins), desktop, rules */}
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Анкета специалиста — единственная дорога к бронированию для
                    нового аккаунта (роль user). Раньше в /m её не было вовсе. */}
                {!canBookCabinets(currentUser) && (
                    <NavRow
                        icon={<ClipboardCheck size={16} />}
                        label="Анкета специалиста"
                        sub="Нужна, чтобы бронировать кабинеты"
                        onClick={() => navigate('/become-specialist')}
                    />
                )}
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
                        sub="Дашборд, пользователи, срочные заявки"
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
                            <MapPin size={16} color={COLOR.ink} aria-hidden="true" />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, fontWeight: 600 }}>{loc.name}</div>
                                <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 1 }}>{loc.address}</div>
                            </div>
                            <ArrowUpRight size={16} color={COLOR.ink60} aria-hidden="true" />
                        </a>
                    ))}
                    <a href={`tel:${PHONE.replace(/\s/g, '')}`} style={contactRowStyle}>
                        <Phone size={16} color={COLOR.ink} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{PHONE}</div>
                            <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 1 }}>Звонок · WhatsApp</div>
                        </div>
                    </a>
                    <a
                        href={`https://t.me/${ADMIN_TG}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={contactRowStyle}
                    >
                        <MessageCircle size={16} color={COLOR.ink} aria-hidden="true" />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>Связь с администратором</div>
                            <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 1 }}>Telegram · @{ADMIN_TG}</div>
                        </div>
                        <ArrowUpRight size={16} color={COLOR.ink60} aria-hidden="true" />
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
                        color: STATUS.danger.fg,
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
    background: COLOR.card,
    border: `1px solid ${COLOR.ink08}`,
    borderRadius: 12,
    padding: '12px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    color: COLOR.ink,
    textDecoration: 'none',
};

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: COLOR.ink60,
            marginBottom: 8,
        }}>{children}</div>
    );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'danger' }) {
    return (
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: COLOR.ink60, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
                {label}
            </div>
            <div style={{
                fontSize: 17, fontWeight: 600,
                color: tone === 'danger' ? STATUS.danger.fg : COLOR.ink,
                marginTop: 2,
                lineHeight: 1.1,
            }}>
                {value}
                {sub && <span style={{ fontSize: 12, fontWeight: 500, color: COLOR.ink60, marginLeft: 4 }}>{sub}</span>}
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
                background: COLOR.card,
                border: `1px solid ${COLOR.ink08}`,
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: COLOR.ink,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                width: '100%',
            }}
        >
            <div style={{
                width: 28, height: 28,
                borderRadius: 8,
                background: COLOR.sunken,
                display: 'grid', placeItems: 'center',
                flexShrink: 0,
            }}>
                {icon}
            </div>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
                {sub && <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 1 }}>{sub}</div>}
            </div>
            <ChevronRight size={16} color={COLOR.ink60} />
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
