import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { BookOpen, Briefcase, Building2, ClipboardCheck, Eye, Gift, HelpCircle, LogOut, MapPin, MessageCircle, Phone, ShieldCheck, Star, Tags, Ticket, UserRound, Users, Wallet } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { bonusesApi, type Bonus } from '../../api/bonuses';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import { getFavoriteCabinet, setFavoriteCabinet } from './favoriteCabinet';
import { fmtHours, subscriptionOverview } from '../../utils/paymentPriority';
import { extraPoolLabel } from '../../utils/subscriptionHours';
import { resetTour } from './OnboardingTour';
import { canBookCabinets } from '../../utils/permissions';
import { COLOR, SHAPE, STATUS, TEXT } from '../../design/tokens';
import { catalogPath } from '../../utils/catalogPath';
import { SPECIALIST_APPLICATION_PATH } from '../../components/SpecialistGate';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Money } from '../../components/ui/Money';
import { ListGroup, ListIcon, ListRow } from '../../components/ui/ListRow';
import { ChoiceCard, ChoiceGroup } from '../../components/ui/ChoiceCard';
import { canUsePsyCrm } from './crmAccess';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
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
    const { confirm } = useConfirmDialog();
    const [favOpen, setFavOpen] = useState(false);

    useEffect(() => {
        // Только для строки «Бонусы · N ч». Сбой не мешает остальному экрану.
        bonusesApi.getMyBonuses()
            .then(list => setBonuses(list.filter(b => b.status === 'active')))
            .catch(() => setBonuses(null));
    }, []);

    if (!currentUser) return null;

    const favOptions = RESOURCES.filter(r => r.locationId !== 'neo_school' && r.isActive !== false);
    const favRes = favCab ? favOptions.find(r => r.id === favCab) : null;
    const favLabel = favRes ? favRes.name : 'Любой';
    const pickFav = (val: string | null) => {
        setFavCab(val);
        setFavoriteCabinet(currentUser.id, val);
    };

    const tgConnected = !!currentUser.telegramId && /^\d+$/.test(currentUser.telegramId);
    const isAdmin = currentUser.role === 'owner' || currentUser.role === 'senior_admin' || currentUser.role === 'admin' || currentUser.isAdmin;
    // CRM — по тому же правилу, что сервер (X2-ia-navigation-M3).
    const showCrm = canUsePsyCrm(currentUser);

    const balance = currentUser.balance ?? 0;
    const debt = balance < 0 ? -balance : 0;
    const sub = currentUser.subscription;
    // Часы будущих, ещё не списанных броней «с абонемента» уже обещаны —
    // без них «осталось 6 ч» обманывало (G4-client-mobile-M1). 09.11 (№3):
    // справа — то же «свободно», что на «Абонементе» и в оплате.
    const subView = subscriptionOverview(sub, bookings, currentUser.email);
    const bonusHours = bonuses ? bonuses.reduce((s, b) => s + (b.quantity || 0), 0) : null;

    // 09.11 (ревью №20): случайное нажатие больше не выбрасывает на вход.
    const handleLogout = async () => {
        const ok = await confirm({
            title: 'Выйти из аккаунта?',
            body: 'Чтобы снова бронировать, нужно будет войти заново.',
            confirmLabel: 'Выйти',
            cancelLabel: 'Остаться',
            tone: 'danger',
        });
        if (!ok) return;
        logout();
        navigate('/login');
    };

    return (
        <div style={{
            paddingTop: 16, paddingBottom: 24,
            display: 'flex', flexDirection: 'column', gap: 24,
        }}>
            {/* Кто я — 09.11 фаза 3: круг с инициалами (экран «про меня» без лица). */}
            <div style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <span aria-hidden="true" style={{
                    flex: 'none', width: 56, height: 56, borderRadius: SHAPE.pill,
                    background: COLOR.accentSoft, color: COLOR.accentInk,
                    display: 'grid', placeItems: 'center',
                    fontSize: TEXT.title, fontWeight: 600,
                }}>
                    {initialsOf(currentUser.name || currentUser.email || '')}
                </span>
                <div style={{ minWidth: 0 }}>
                    <h1 style={{ fontSize: TEXT.heading, fontWeight: 600, margin: 0, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
                        {currentUser.name}
                    </h1>
                    <div style={{ fontSize: TEXT.small, color: COLOR.ink60, marginTop: 4, overflowWrap: 'anywhere' }}>
                        {currentUser.email}
                    </div>
                </div>
            </div>

            <Group title="Кошелёк">
                <MenuRow
                    icon={<Wallet size={18} />}
                    label="Баланс"
                    value={<Money value={balance} tone="balance" fraction={0} />}
                    sub={debt > 0 ? 'Долг · история · Как пополнить баланс' : 'История · Как пополнить баланс'}
                    onClick={() => navigate('/m/balance')}
                />
                <MenuRow
                    icon={<Ticket size={18} />}
                    label="Абонемент"
                    value={sub && subView
                        ? <span className="num">{fmtHours(subView.free)} свободно</span>
                        : 'Нет'}
                    sub={sub && subView
                        ? [sub.name,
                            subView.reserved > 0.01 ? `ещё ${fmtHours(subView.reserved)} в ваших бронях` : null,
                            `всего ${fmtHours(subView.total)}`,
                            extraPoolLabel(sub)]
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
                {/* Любимый кабинет — первым при поиске свободного времени.
                    09.11 фаза 3: строка списка «Любимый кабинет · Любой ›», выбор — в шторке
                    (выпадающий список ломал колонку и в тёмной теме терял стрелку). */}
                <MenuRow
                    icon={<Star size={18} />}
                    label="Любимый кабинет"
                    sub="Покажем его первым при поиске свободного времени"
                    value={favLabel}
                    onClick={() => setFavOpen(true)}
                />
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

            <Sheet
                open={favOpen}
                onClose={() => setFavOpen(false)}
                title="Любимый кабинет"
                description="Покажем его первым при поиске свободного времени."
                footer={<Button block onClick={() => setFavOpen(false)}>Готово</Button>}
            >
                <ChoiceGroup label="Любимый кабинет">
                    <ChoiceCard selected={!favCab} onClick={() => pickFav(null)} title="Любой" />
                    {favOptions.map(r => {
                        const loc = LOCATIONS.find(l => l.id === r.locationId);
                        return (
                            <ChoiceCard
                                key={r.id}
                                selected={favCab === r.id}
                                onClick={() => pickFav(r.id)}
                                title={r.name}
                                description={loc?.name}
                            />
                        );
                    })}
                </ChoiceGroup>
            </Sheet>

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

        </div>
    );
}

/** 09.11 фаза 3: разделы «Я» — общий ListGroup (одна карточка, линии между строками). */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ padding: '0 16px' }}>
            <ListGroup title={title}>{children}</ListGroup>
        </div>
    );
}

/** Строка меню «Я» — переход внутри приложения (общий ListRow). Значение справа 14/600. */
function MenuRow({ icon, label, sub, value, onClick }: {
    icon: React.ReactNode;
    label: string;
    sub?: string;
    value?: React.ReactNode;
    onClick: () => void;
}) {
    return (
        <ListRow
            onClick={onClick}
            lead={<ListIcon>{icon}</ListIcon>}
            title={label}
            subtitle={sub}
            trail={value}
        />
    );
}

/** Строка меню — внешняя ссылка (карта, Telegram, звонок): те же классы строки. */
function MenuLink({ href, icon, label, sub, internal }: {
    href: string;
    icon: React.ReactNode;
    label: string;
    sub?: string;
    /** tel: — открывается без новой вкладки и без значка «наружу». */
    internal?: boolean;
}) {
    return (
        <ListRow
            href={href}
            target={internal ? undefined : '_blank'}
            lead={<ListIcon>{icon}</ListIcon>}
            title={label}
            subtitle={sub}
        />
    );
}

function initialsOf(name: string): string {
    return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}
