import { useNavigate } from 'react-router-dom';
import { Children, Fragment, useEffect, useState } from 'react';
import {
    ArrowUpRight, BookOpen, Briefcase, Building2, ChevronRight, ClipboardCheck, Eye, Gift, HelpCircle,
    LogOut, MapPin, MessageCircle, Phone, ShieldCheck, Tags, Ticket, UserRound, Users, Wallet,
} from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { bonusesApi, type Bonus } from '../../api/bonuses';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import { getFavoriteCabinet, setFavoriteCabinet } from './favoriteCabinet';
import { fmtHours, reservedSubscriptionHours } from '../../utils/paymentPriority';
import { extraPoolLabel } from '../../utils/subscriptionHours';
import { resetTour } from './OnboardingTour';
import { canBookCabinets } from '../../utils/permissions';
import { COLOR, RADIUS, STATUS, TEXT } from '../../design/tokens';
import { formatGel } from '../../utils/format';
import { catalogPath } from '../../utils/catalogPath';
import { SPECIALIST_APPLICATION_PATH } from '../../components/SpecialistGate';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Field';
import { canUsePsyCrm } from './crmAccess';
import { mapsUrl } from './bookingView';

const ADMIN_TG = 'UnboxCenter';
const PHONE = '+995 599 324 668';

/** Ссылка в Telegram администратора с готовым текстом. */
function adminTgLink(text?: string): string {
    return `https://t.me/${ADMIN_TG}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/**
 * /m/me — «Я» (волна 2, G4-06 + X2-08, G4-20).
 *
 * Разделы: Кошелёк (баланс → как пополнить, абонемент, бонусы) · Каталог
 * (специалисты, кабинеты, тарифы, «Слежу за слотами» — раньше из приложения
 * туда было не попасть) · Профиль и уведомления · Работа (анкета, CRM,
 * админка) · Помощь. Все переходы — navigate(), без перезагрузки
 * (X2-ia-navigation-M2: абонемент, бонусы и правила открывались с белым
 * экраном). Список бонусов больше не дублирует /m/bonuses — одна строка.
 */
export function MobileProfile() {
    const navigate = useNavigate();
    const { currentUser, logout, bookings } = useUserStore();
    const [bonuses, setBonuses] = useState<Bonus[] | null>(null);
    const [favCab, setFavCab] = useState<string | null>(() => getFavoriteCabinet(currentUser?.id));
    const [topUpOpen, setTopUpOpen] = useState(false);

    useEffect(() => {
        // Только для строки «Бонусы · N ч». Сбой не мешает остальному экрану.
        bonusesApi.getMyBonuses()
            .then(list => setBonuses(list.filter(b => b.status === 'active')))
            .catch(() => setBonuses(null));
    }, []);

    if (!currentUser) return null;

    const tgConnected = !!currentUser.telegramId && /^\d+$/.test(currentUser.telegramId);
    const isAdmin = currentUser.role === 'owner' || currentUser.role === 'senior_admin' || currentUser.role === 'admin' || currentUser.isAdmin;
    // CRM — по тому же правилу, что сервер (X2-ia-navigation-M3).
    const showCrm = canUsePsyCrm(currentUser);

    const balance = currentUser.balance ?? 0;
    const debt = balance < 0 ? -balance : 0;
    const sub = currentUser.subscription;
    // Часы будущих, ещё не списанных броней «с абонемента» уже обещаны —
    // без них «осталось 6 ч» обманывало (G4-client-mobile-M1).
    const subReserved = reservedSubscriptionHours(sub, bookings, currentUser.email);
    const bonusHours = bonuses ? bonuses.reduce((s, b) => s + (b.quantity || 0), 0) : null;

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div style={{
            paddingTop: 16, paddingBottom: 24,
            display: 'flex', flexDirection: 'column', gap: 24,
        }}>
            {/* Кто я */}
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: TEXT.heading, fontWeight: 600, margin: 0, lineHeight: 1.2 }}>
                    {currentUser.name}
                </h1>
                <div style={{ fontSize: TEXT.small, color: COLOR.ink60, marginTop: 4 }}>
                    {currentUser.email}
                </div>
            </div>

            <Group title="Кошелёк">
                <MenuRow
                    icon={<Wallet size={18} />}
                    label="Баланс"
                    value={<span className="num" style={{ color: debt > 0 ? STATUS.danger.fg : COLOR.ink, fontWeight: 600 }}>{formatGel(balance, { fraction: 0 })}</span>}
                    sub={debt > 0 ? 'Долг — как пополнить' : 'Как пополнить'}
                    onClick={() => setTopUpOpen(true)}
                />
                <MenuRow
                    icon={<Ticket size={18} />}
                    label="Абонемент"
                    value={sub
                        ? <span className="num">{fmtHours(sub.remainingHours)} из {fmtHours(sub.totalHours)}</span>
                        : 'Нет'}
                    sub={sub
                        ? [subReserved > 0.01 ? `${sub.name} · ${fmtHours(subReserved)} уже в бронях` : sub.name, extraPoolLabel(sub)]
                            .filter(Boolean).join(' · ')
                        : 'Час по абонементу дешевле — выбрать тариф'}
                    onClick={() => navigate('/m/subscription')}
                />
                <MenuRow
                    icon={<Gift size={18} />}
                    label="Бонусы"
                    value={bonusHours == null ? undefined : bonusHours > 0 ? <span className="num">{fmtHours(bonusHours)}</span> : 'Нет'}
                    sub="Бесплатные часы и когда они сгорают"
                    onClick={() => navigate('/m/bonuses')}
                />
            </Group>

            {/* X2-08 / G4-06: каталог внутри приложения. */}
            <Group title="Каталог">
                <MenuRow icon={<Users size={18} />} label="Специалисты" onClick={() => navigate('/m/specialists')} />
                <MenuRow icon={<Building2 size={18} />} label="Кабинеты" sub="Фото, описания, цены" onClick={() => navigate('/m/places')} />
                <MenuRow icon={<Tags size={18} />} label="Тарифы" onClick={() => navigate('/m/tariffs')} />
                <MenuRow icon={<Eye size={18} />} label="Слежу за слотами" sub="Сообщим, когда занятое время освободится" onClick={() => navigate('/m/waitlist')} />
            </Group>

            <Group title="Профиль и уведомления">
                <MenuRow
                    icon={<UserRound size={18} />}
                    label="Профиль"
                    sub={`Имя, телефон · Telegram ${tgConnected ? 'подключён' : 'не подключён'}`}
                    onClick={() => navigate('/m/profile')}
                />
                {/* Любимый кабинет — первым при поиске свободного времени. */}
                <div style={{ padding: '12px 16px' }}>
                    <label htmlFor="m-fav-cab" style={{ display: 'block', fontSize: TEXT.small, fontWeight: 600, marginBottom: 8 }}>
                        Любимый кабинет
                    </label>
                    <Select
                        id="m-fav-cab"
                        value={favCab ?? ''}
                        onChange={e => {
                            const val = e.target.value || null;
                            setFavCab(val);
                            setFavoriteCabinet(currentUser.id, val);
                        }}
                    >
                        <option value="">Любой</option>
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
                    </Select>
                    <div style={{ fontSize: TEXT.caption, color: COLOR.ink60, marginTop: 6 }}>
                        Покажем его первым при поиске свободного времени.
                    </div>
                </div>
                <MenuRow
                    icon={<HelpCircle size={18} />}
                    label="Показать обзор заново"
                    sub="Полминуты: где что в приложении"
                    onClick={() => {
                        resetTour(currentUser?.id);
                        // ?tour=1 — MobileLayout откроет обзор сразу, без перезагрузки.
                        navigate('/m/today?tour=1');
                    }}
                />
            </Group>

            {(!canBookCabinets(currentUser) || showCrm || isAdmin) && (
                <Group title="Работа">
                    {/* Анкета специалиста — единственная дорога к бронированию для
                        нового аккаунта (роль user). Открывается внутри /m. */}
                    {!canBookCabinets(currentUser) && (
                        <MenuRow
                            icon={<ClipboardCheck size={18} />}
                            label="Анкета специалиста"
                            sub="Нужна, чтобы бронировать кабинеты"
                            onClick={() => navigate(catalogPath(SPECIALIST_APPLICATION_PATH, true))}
                        />
                    )}
                    {showCrm && (
                        <MenuRow
                            icon={<Briefcase size={18} />}
                            label="CRM"
                            sub="Клиенты, сессии, заметки"
                            onClick={() => navigate('/m/crm')}
                        />
                    )}
                    {isAdmin && (
                        <MenuRow
                            icon={<ShieldCheck size={18} />}
                            label="Админка"
                            sub="Сводка, пользователи, заявки"
                            onClick={() => navigate('/m/admin')}
                        />
                    )}
                </Group>
            )}

            <Group title="Помощь">
                <MenuRow icon={<BookOpen size={18} />} label="Правила бронирования" onClick={() => navigate('/m/booking-rules')} />
                {LOCATIONS.filter(l => l.id !== 'neo_school').map(loc => (
                    <MenuLink
                        key={loc.id}
                        href={mapsUrl(loc) ?? '#'}
                        icon={<MapPin size={18} />}
                        label={loc.name}
                        sub={`${loc.address}, Батуми`}
                    />
                ))}
                <MenuLink
                    href={`tel:${PHONE.replace(/\s/g, '')}`}
                    icon={<Phone size={18} />}
                    label={PHONE}
                    sub="Звонок · WhatsApp"
                    internal
                />
                <MenuLink
                    href={adminTgLink()}
                    icon={<MessageCircle size={18} />}
                    label="Написать администратору"
                    sub={`Telegram · @${ADMIN_TG}`}
                />
            </Group>

            {/* Logout */}
            <div style={{ padding: '0 16px' }}>
                <Button
                    variant="quiet"
                    block
                    onClick={handleLogout}
                    icon={<LogOut size={16} aria-hidden="true" />}
                    style={{ color: STATUS.danger.fg }}
                >
                    Выйти
                </Button>
            </div>

            {/* G4-20: как пополнить баланс — раньше плитка «Баланс» молчала. */}
            <Sheet
                open={topUpOpen}
                onClose={() => setTopUpOpen(false)}
                title="Как пополнить баланс"
                footer={
                    <>
                        <a
                            href={adminTgLink('Здравствуйте! Хочу пополнить баланс.')}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ui-btn ui-btn--primary ui-btn--block"
                            style={{ textDecoration: 'none' }}
                        >
                            Написать администратору
                        </a>
                        <Button variant="secondary" block onClick={() => setTopUpOpen(false)}>Понятно</Button>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: TEXT.body, lineHeight: 1.5 }}>
                    <p style={{ margin: 0 }}>
                        Сейчас на балансе <b className="num">{formatGel(balance, { fraction: 0 })}</b>.
                    </p>
                    <p style={{ margin: 0, color: COLOR.ink80 }}>
                        Баланс пополняет администратор: наличными в центре или переводом. Напишите нам — подскажем,
                        как удобнее, и зачислим деньги.
                    </p>
                </div>
            </Sheet>
        </div>
    );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section style={{ padding: '0 16px' }}>
            <h2 style={{
                fontSize: TEXT.caption, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: COLOR.ink60,
                margin: '0 0 8px',
            }}>{title}</h2>
            <div style={{
                background: COLOR.card,
                border: `1px solid ${COLOR.ink10}`,
                borderRadius: RADIUS.sheet,
                overflow: 'hidden',
            }}>
                {/* Тонкая линия между строками (не над первой). */}
                {Children.toArray(children).filter(Boolean).map((child, i) => (
                    <Fragment key={i}>
                        {i > 0 && <div aria-hidden="true" style={{ height: 1, background: COLOR.ink10, marginLeft: 52 }} />}
                        {child}
                    </Fragment>
                ))}
            </div>
        </section>
    );
}

const rowStyle: React.CSSProperties = {
    width: '100%',
    minHeight: 56,
    background: 'transparent',
    border: 'none',
    padding: '10px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    color: COLOR.ink,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    textDecoration: 'none',
};

function RowBody({ icon, label, sub, value }: { icon: React.ReactNode; label: string; sub?: string; value?: React.ReactNode }) {
    return (
        <>
            <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 24, flexShrink: 0, color: COLOR.ink80 }}>{icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: TEXT.body, fontWeight: 600 }}>{label}</span>
                {sub && <span style={{ display: 'block', fontSize: TEXT.small, color: COLOR.ink60, marginTop: 1 }}>{sub}</span>}
            </span>
            {value !== undefined && <span style={{ fontSize: TEXT.small, color: COLOR.ink80, flexShrink: 0 }}>{value}</span>}
        </>
    );
}

/** Строка меню «Я» — переход внутри приложения. */
function MenuRow({ icon, label, sub, value, onClick }: {
    icon: React.ReactNode;
    label: string;
    sub?: string;
    value?: React.ReactNode;
    onClick: () => void;
}) {
    return (
        <button type="button" onClick={onClick} className="press" style={rowStyle}>
            <RowBody icon={icon} label={label} sub={sub} value={value} />
            <ChevronRight size={18} color={COLOR.ink60} aria-hidden="true" style={{ flexShrink: 0 }} />
        </button>
    );
}

/** Строка меню — внешняя ссылка (карта, Telegram, звонок). */
function MenuLink({ href, icon, label, sub, internal }: {
    href: string;
    icon: React.ReactNode;
    label: string;
    sub?: string;
    /** tel: — открывается без новой вкладки и без значка «наружу». */
    internal?: boolean;
}) {
    return (
        <a
            href={href}
            {...(internal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
            className="press"
            style={rowStyle}
        >
            <RowBody icon={icon} label={label} sub={sub} />
            {!internal && <ArrowUpRight size={16} color={COLOR.ink60} aria-hidden="true" style={{ flexShrink: 0 }} />}
        </a>
    );
}
