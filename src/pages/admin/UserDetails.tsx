import { useParams, useNavigate } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { LegacyButton as Button } from '../../components/ui/LegacyButton';
import { Card } from '../../components/ui/Card';
import { Mail, Phone, CreditCard, Shield, ArrowLeft, Plus, History, RotateCcw, ChevronDown, UserCheck, UserCircle, X, Loader2, PackagePlus, KeyRound, CalendarClock, CheckCircle2, XCircle, Clock, Pencil, Check, Wallet, AlertTriangle } from 'lucide-react';
import { BalanceCorrectionModal } from '../../components/admin/BalanceCorrectionModal';
import { hasPermission } from '../../utils/permissions';
import { format } from 'date-fns';
import { safeFormat } from '../../utils/dateUtils';
import { subscriptionBadge, subscriptionLifecycle } from '../../utils/subscription';
import { bookingsApi } from '../../api/bookings';
import { usersApi } from '../../api/users';
import type { BookingHistoryItem } from '../../store/types';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { RESOURCES, SUBSCRIPTION_PLANS } from '../../utils/data';
import { UserTags } from '../../components/admin/UserTags';
import { UserTasks } from '../../components/admin/UserTasks';
import { UserContacts } from '../../components/admin/UserContacts';
import { UserTransactions } from '../../components/admin/UserTransactions';
import { UserBalanceLedger } from '../../components/admin/UserBalanceLedger';
import { ProfessionEditor } from '../../components/admin/ProfessionEditor';
import { TargetAudienceEditor } from '../../components/admin/TargetAudienceEditor';
import { UserBookingsTab } from '../../components/admin/UserBookingsTab';
import { UserLoyaltyCard } from '../../components/admin/UserLoyaltyCard';
import { UserComments } from '../../components/admin/UserComments';
import { ClientTimeline } from '../../components/admin/ClientTimeline';
import { UserBonuses } from '../../components/admin/UserBonuses';

import { AddFundsModal } from '../../components/admin/modals/AddFundsModal';
import { AssignSubscriptionModal } from '../../components/admin/modals/AssignSubscriptionModal';
import { EditCreditLimitModal } from '../../components/admin/modals/EditCreditLimitModal';
import { ResetPasswordModal } from '../../components/admin/modals/ResetPasswordModal';
import { MergeAccountsModal } from '../../components/admin/modals/MergeAccountsModal';
import { api } from '../../api/client';
import { cashboxApi } from '../../api/cashbox';
import { crmApi, type CrmAccessStatus } from '../../api/crm';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { Sheet } from '../../components/ui/Sheet';
import { Button as UiButton } from '../../components/ui/Button';
import { Field, Input, type InputKind } from '../../components/ui/Field';
import { statusLabel } from '../../design/statuses';
import { formatGel, formatDayMonth, formatTime } from '../../utils/format';
import { SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';

const ghudMono: React.CSSProperties = {
    fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const,
};

/** Заголовок блока абонемента под его реальный статус. */
const SUB_TITLE: Record<string, string> = {
    active: 'Активный абонемент',
    frozen: 'Абонемент на паузе',
    completed: 'Завершённый абонемент',
    none: 'Абонемент',
};

export function AdminUserDetails() {
    const { email } = useParams<{ email: string }>();
    const navigate = useNavigate();
    const { users, updateUserById, currentUser, cancelBooking } = useUserStore();

    /** The URL param can arrive in three forms — already-decoded, %-encoded,
     *  or with stray whitespace from a copy-paste. Normalize to lowercase
     *  trimmed for the comparison so admins don't see "Клиент не найден"
     *  on a real user just because of a casing mismatch. */
    const normalizeEmail = (raw: string | undefined): string => {
        if (!raw) return '';
        let s = raw.trim();
        try { s = decodeURIComponent(s); } catch { /* already decoded or malformed */ }
        return s.trim().toLowerCase();
    };
    const targetEmail = normalizeEmail(email);

    // Find User — match on the normalized form so "psy_ann@bk.ru",
    // "psy_ann%40bk.ru", and "PSY_ANN@bk.ru" all resolve to the same row.
    const user = users.find(u => (u.email || '').trim().toLowerCase() === targetEmail);

    const [isAddFundsOpen, setIsAddFundsOpen] = useState(false);
    const [isAssignSubOpen, setIsAssignSubOpen] = useState(false);
    const [isEditLimitOpen, setIsEditLimitOpen] = useState(false);
    const [isBalanceCorrectionOpen, setIsBalanceCorrectionOpen] = useState(false);
    // Сброс пароля и склейка аккаунтов — свои окна вместо prompt()/confirm()
    // (аудит 29.09, G7-04). Хуки — до раннего return «Загрузка…».
    const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
    const [isMergeOpen, setIsMergeOpen] = useState(false);
    // Wave 1: подтверждения — общее окно с кнопками-действиями; правка телефона,
    // Telegram, email и причины архивации — шторка с полем вместо prompt().
    const { confirm } = useConfirmDialog();
    const [editField, setEditField] = useState<null | 'phone' | 'telegram' | 'email' | 'archive'>(null);
    const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
    const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);
    const [adminPickerType, setAdminPickerType] = useState<'responsible' | 'attracted' | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'bookings' | 'finance' | 'timeline'>('overview');

    // Subscription topup form state
    const [isTopupOpen, setIsTopupOpen] = useState(false);
    const [isEditingExpiry, setIsEditingExpiry] = useState(false);
    const [editExpiryDate, setEditExpiryDate] = useState('');
    // Excel #84 — inline display-name editing. Used when the backend-derived
    // name ("Галина") is too short to tell clients apart in schedules, and
    // admins want to extend it ("Галина Иващенко").
    const [isEditingName, setIsEditingName] = useState(false);
    const [editName, setEditName] = useState('');
    const [savingName, setSavingName] = useState(false);
    const [topupForm, setTopupForm] = useState({ hours: '', amount: '', payment_method: 'cash', note: '' });
    const [topupSaving, setTopupSaving] = useState(false);
    // «Общая сумма оплат» — из реального бэкенда (кассовые приходы клиента),
    // а не из фронтового стора, который пустой на перезагрузке.
    const [totalPaid, setTotalPaid] = useState<number | null>(null);
    const reloadTotalPaid = async () => {
        if (!user) return;
        try { setTotalPaid(await cashboxApi.getClientTotalPaid(user.id || user.email)); }
        catch { /* нет доступа к кассе у этого админа — оставим прочерк */ }
    };

    // CRM Access state
    const [crmAccess, setCrmAccess] = useState<(CrmAccessStatus & { profession?: string; message?: string; submittedAt?: string }) | null>(null);
    const [crmActionLoading, setCrmActionLoading] = useState(false);

    const ADMIN_ROLES = ['owner', 'senior_admin', 'admin'];
    const adminUsers = users.filter(u => u.role && ADMIN_ROLES.includes(u.role));
    const adminMap = new Map(adminUsers.map(a => [a.id, a]));
    const responsibleAdmin = user?.responsibleAdminId ? adminMap.get(user.responsibleAdminId) : null;
    const attractedAdmin   = user?.attractedByAdminId  ? adminMap.get(user.attractedByAdminId)  : null;
    // Let's keep 'overview' default but I will change it in the replacement to 'timeline' to show it off immediately, or maybe 'overview' is safer. Let's use 'overview' but add 'timeline' to type.

    // Fetch CRM access status
    const fetchCrmAccess = useCallback(async () => {
        if (!user?.id) return;
        try {
            const data = await crmApi.getUserAccess(user.id);
            setCrmAccess(data);
        } catch {
            setCrmAccess(null);
        }
    }, [user?.id]);

    useEffect(() => {
        fetchCrmAccess();
    }, [fetchCrmAccess]);

    // Pull the users list when this page is opened directly (deep link
    // from Telegram, paste from URL, etc.) and the store is still empty.
    // Without this the lookup `users.find(u => u.email === ...)` returns
    // undefined and the page renders "Клиент не найден" even for users
    // who exist — admins reported `/admin/users/psy_ann@bk.ru` doing
    // exactly that.
    const fetchUsers = useUserStore(s => s.fetchUsers);
    useEffect(() => {
        if (users.length === 0) fetchUsers();
    }, [users.length, fetchUsers]);

    // Брони ЭТОГО клиента — с сервера, а не фильтром общего списка.
    // Общий список обрезан потолком в 5000, а броней уже 6115: хвост молча
    // отбрасывался, и в карточке показывалось «0 часов / 0 бронирований»
    // либо заниженные цифры (у Нади Мирошиной 10 броней из 45 не попадали).
    // Дальше было бы только хуже. У одного человека броней десятки — потолок
    // тут не мешает, и заодно в браузер не тянется вся база броней.
    const [userBookings, setUserBookings] = useState<BookingHistoryItem[]>([]);
    const [bookingsLoading, setBookingsLoading] = useState(true);
    const reloadUserBookings = async (email?: string) => {
        if (!email) return;
        setBookingsLoading(true);
        try { setUserBookings(await bookingsApi.getUserBookings(email)); }
        catch { setUserBookings([]); }
        finally { setBookingsLoading(false); }
    };
    useEffect(() => {
        reloadUserBookings(user?.email);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.email]);

    // «Общая сумма оплат» — тянем с бэка, когда клиент определился.
    useEffect(() => {
        if (user) reloadTotalPaid();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, user?.email]);

    // ВАЖНО: этот хук обязан стоять ДО раннего return ниже. Когда он жил после,
    // холодная загрузка карточки (F5/прямая ссылка: users ещё пуст → return
    // «Загрузка…» → users подгрузились → ре-рендер с +1 хуком) роняла ВЕСЬ
    // /admin через ErrorBoundary: «Rendered more hooks…» (консилиум 27.08).
    const [convertingId, setConvertingId] = useState<string | null>(null);

    if (!user) {
        // While the initial fetch is in flight, show a spinner instead of
        // the false-negative "Клиент не найден". Distinguishes "still
        // loading" from "really doesn't exist".
        if (users.length === 0) {
            return <div className="p-8"><SkeletonList count={3} label="Загружаем карточку клиента" /></div>;
        }
        return (
            <EmptyState
                title="Клиент не найден"
                hint="Возможно, email изменился или аккаунт склеили с другим. Найдите клиента в списке."
                action={{ label: 'К списку клиентов', onClick: () => navigate(window.location.pathname.startsWith('/m/admin') ? '/m/admin/users' : '/admin/users') }}
            />
        );
    }

    const handleCrmApprove = async (days: number) => {
        setCrmActionLoading(true);
        try {
            await crmApi.approveAccessRequest(user.id, days);
            toast.success(`CRM доступ одобрен на ${days} дней`);
            fetchCrmAccess();
        } catch {
            toast.error('Ошибка при одобрении доступа');
        } finally {
            setCrmActionLoading(false);
        }
    };

    const handleCrmReject = async () => {
        setCrmActionLoading(true);
        try {
            await crmApi.rejectAccessRequest(user.id);
            toast.success('Запрос отклонён');
            fetchCrmAccess();
        } catch {
            toast.error('Ошибка при отклонении запроса');
        } finally {
            setCrmActionLoading(false);
        }
    };

    // derived data — уже только этого клиента (пришли с сервера отфильтрованными)
    // ВНИМАНИЕ: sortedBookings отсортирован по дате СОЗДАНИЯ (createdAt) — на этом
    // порядке завязан расчёт «первая/последняя встреча» ниже. Не менять.
    const sortedBookings = [...userBookings]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Лиза (админ): перед отпуском специалиста админ отменяет брони диапазоном.
    // Для этого список во вкладке «Бронирования» — в хронологическом порядке:
    // ближайшие ПРЕДСТОЯЩИЕ сверху (по возрастанию даты), затем прошедшие
    // (свежие выше). Так проще найти и отменить нужный будущий диапазон.
    const bookingDateTime = (b: BookingHistoryItem) => {
        const d = new Date(b.date);
        if (b.startTime) {
            const [h, m] = b.startTime.split(':').map(Number);
            d.setHours(h || 0, m || 0, 0, 0);
        }
        return d.getTime();
    };
    const chronoBookings = [...userBookings].sort((a, b) => {
        const now = Date.now();
        const ta = bookingDateTime(a), tb = bookingDateTime(b);
        const aUpcoming = ta >= now, bUpcoming = tb >= now;
        if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1; // предстоящие выше прошедших
        return aUpcoming ? ta - tb : tb - ta;                  // будущее ↑, прошлое ↓
    });



    const handleAddFunds = async (amount: number, method: 'cash' | 'tbc' | 'bog', branch?: string) => {
        // ЕДИНАЯ операция пополнения — одна и та же везде (карточка И Финансы):
        // приход в кассу + зачисление на баланс клиента, атомарно на бэкенде
        // (credit_user_balance). Раньше баланс правился отдельно на фронте, а
        // касса — отдельным вызовом без привязки клиента, отсюда рассинхрон.
        const methodMap: Record<string, string> = { cash: 'cash', tbc: 'card_tbc', bog: 'card_bog' };
        try {
            await cashboxApi.createTransaction({
                type: 'income',
                amount,
                payment_method: methodMap[method] || 'cash',
                category_id: 'cat-topup',
                description: `Пополнение баланса: ${user.name}`,
                branch: branch || undefined,
                client_id: user.id || user.email,
                credit_user_balance: true,
            } as any);
            // Баланс посчитал бэк — подтягиваем свежие данные и сумму оплат.
            await fetchUsers();
            await reloadTotalPaid();
            toast.success(`Баланс пополнен на ${amount} ₾ (${method})`);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось пополнить баланс (нужен доступ к кассе)');
        }
    };

    const handleUpdateCreditLimit = async (limit: number) => {
        // Тост — только после ответа сервера (раньше «установлен» показывался
        // сразу, даже если у админа нет права менять лимит).
        try {
            await usersApi.updateUser(user.email, { creditLimit: limit } as any);
            await useUserStore.getState().fetchUsers();
            toast.success(`Кредитный лимит установлен: ${limit} ₾`);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось изменить кредитный лимит');
        }
    }



    const toggleFreeze = async () => {
        if (!user.subscription) return;
        // Тост — только ПОСЛЕ ответа сервера. Раньше «Абонемент заморожен»
        // показывался мгновенно, даже когда сервер отвечал отказом
        // (повторная заморозка), — админ не понимал, почему ничего не меняется.
        try {
            await useUserStore.getState().toggleSubscriptionFreeze(user.email);
            toast.success(user.subscription.isFrozen ? 'Абонемент разморожен' : 'Абонемент заморожен');
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Не удалось изменить заморозку');
        }
    };

    const handleAssignSubscription = async (planIndex: number, method: 'cash' | 'tbc' | 'bog' | 'balance') => {
        // Продажа одной операцией на сервере (29.09): касса/баланс + списание за
        // абонемент + включение. Раньше при оплате наличными/картой в кассу и в
        // историю баланса не попадало ничего, а «с баланса» могло молча не списать.
        const plan = SUBSCRIPTION_PLANS[planIndex];
        if (!plan) return;
        const methodMap = { cash: 'cash', tbc: 'card_tbc', bog: 'card_bog', balance: 'balance' } as const;
        try {
            const r = await usersApi.sellSubscription(user.id || user.email, {
                planId: plan.id,
                paymentMethod: methodMap[method],
            });
            await useUserStore.getState().fetchUsers();
            toast.success(
                `Абонемент «${r.plan}» включён: ${r.remainingHours} ч до ${safeFormat(r.expiryDate, 'd.MM.yyyy')}`
                + (r.carriedHours ? ` (перенесено ${r.carriedHours} ч)` : '')
                + (r.convertedBookings?.length ? `. Броней переведено на часы: ${r.convertedBookings.length}` : ''),
                { duration: 8000 },
            );
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось продать абонемент');
        }
    };

    const handleCancelBooking = async (id: string) => {
        const ok = await confirm({
            title: 'Отменить бронь?',
            body: 'Клиент увидит бронь в отменённых.',
            confirmLabel: 'Отменить бронь',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) return;
        cancelBooking(id);
        toast.success('Бронирование отменено');
    };

    // «На абонемент» прямо из карточки клиента: клиент мог забронировать в момент,
    // когда часы кончились (бронь ушла за деньги), а абонемент пополнили следом.
    // Перевод вернёт деньги на баланс и спишет час. Кейс Валерии 13.08.
    const handleToSubscription = async (bookingId: string) => {
        const ok = await confirm({
            title: 'Списать с абонемента?',
            body: 'Деньги за эту бронь вернутся на баланс клиента, а часы спишутся с его абонемента.',
            confirmLabel: 'Списать с абонемента',
            cancelLabel: 'Оставить как есть',
        });
        if (!ok) return;
        setConvertingId(bookingId);
        try {
            await bookingsApi.convertToSubscription(bookingId);
            await Promise.all([reloadUserBookings(user?.email), fetchUsers()]);
            toast.success('Бронь переведена на абонемент');
        } catch (e: any) {
            const d = e?.response?.data?.detail;
            toast.error(typeof d === 'string' ? d : 'Не удалось перевести на абонемент');
        } finally {
            setConvertingId(null);
        }
    };

    // Excel #59 — jump to the chessboard with this booking pre-selected
    // and scrolled into view, so the admin can drag it to the new time.
    const handleRescheduleBooking = (id: string) => {
        navigate(`/admin/bookings?view=grid&highlight=${id}`);
    };

    const handleTopup = async () => {
        if (!topupForm.hours || !topupForm.amount) return;
        setTopupSaving(true);
        try {
            await api.post(`/users/${user.id}/subscription/topup`, {
                hours: Number(topupForm.hours),
                amount: Number(topupForm.amount),
                payment_method: topupForm.payment_method,
                ...(topupForm.note ? { note: topupForm.note } : {}),
            });
            await useUserStore.getState().fetchUsers();
            toast.success(`Абонемент пополнен на ${topupForm.hours} ч`);
            setIsTopupOpen(false);
            setTopupForm({ hours: '', amount: '', payment_method: 'cash', note: '' });
        } catch {
            toast.error('Ошибка пополнения абонемента');
        } finally {
            setTopupSaving(false);
        }
    };

    // Analytics
    const completedBookings = sortedBookings.filter(b => b.status === 'completed');
    const firstBookingDate = sortedBookings.length > 0 ? sortedBookings[sortedBookings.length - 1].date : null;
    const lastVisitDate = completedBookings.length > 0 ? completedBookings[0].date : null;

    // Status Logic
    const getClientStatus = () => {
        if (user.manualStatus) return user.manualStatus;

        if (sortedBookings.length === 0 && (!user.registrationDate || new Date(user.registrationDate).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000)) {
            return 'new';
        }
        if (lastVisitDate && new Date(lastVisitDate).getTime() > Date.now() - 45 * 24 * 60 * 60 * 1000) {
            return 'active';
        }
        if (sortedBookings.length > 0) {
            return 'sleeping';
        }
        return 'new';
    };

    const clientStatus = getClientStatus();

    const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
        new: { label: 'Новый', color: 'text-unbox-green', bg: 'bg-unbox-light' },
        active: { label: 'Активный', color: 'text-unbox-green', bg: 'bg-white border border-unbox-green' },
        sleeping: { label: 'Спящий', color: 'text-ink-60', bg: 'bg-unbox-light/30' },
        vip: { label: 'VIP', color: 'text-white', bg: 'bg-unbox-dark' }, // Special status
        partner: { label: 'Партнёр', color: 'text-unbox-dark', bg: 'bg-unbox-light' },
        bad_client: { label: 'Проблемный', color: 'text-unbox-dark', bg: 'bg-unbox-light' },
    };

    const currentStatusConfig = STATUS_CONFIG[clientStatus] || STATUS_CONFIG.new;

    return (
        <div className=''
             style={{ fontFamily: GH_SANS, color: GH.ink }}>
            {/* ... Modals ... */}
            <AddFundsModal
                isOpen={isAddFundsOpen}
                onClose={() => setIsAddFundsOpen(false)}
                onConfirm={handleAddFunds}
                userName={user.name}
            />
            <AssignSubscriptionModal
                isOpen={isAssignSubOpen}
                onClose={() => setIsAssignSubOpen(false)}
                onConfirm={handleAssignSubscription}
                currentSubscriptionName={user.subscription?.name}
            />
            <EditCreditLimitModal
                isOpen={isEditLimitOpen}
                onClose={() => setIsEditLimitOpen(false)}
                currentLimit={user.creditLimit || 0}
                onConfirm={handleUpdateCreditLimit}
            />
            <BalanceCorrectionModal
                isOpen={isBalanceCorrectionOpen}
                userId={user.id}
                userName={user.name}
                currentBalance={Number(user.balance || 0)}
                onClose={() => setIsBalanceCorrectionOpen(false)}
                onSaved={async () => { await useUserStore.getState().fetchUsers(); }}
            />
            <ResetPasswordModal
                open={isResetPasswordOpen}
                onClose={() => setIsResetPasswordOpen(false)}
                user={{ id: user.id, email: user.email, name: user.name }}
            />
            <UserFieldSheets
                user={user}
                field={editField}
                onClose={() => setEditField(null)}
                updateUserById={updateUserById}
                afterEmailChange={async (next) => {
                    // Сначала свежий список, потом переход — иначе новая карточка
                    // ищет клиента по новому email в старом списке («не найден»).
                    await fetchUsers();
                    navigate(`/admin/users/${encodeURIComponent(next)}`, { replace: true });
                }}
            />
            <MergeAccountsModal
                open={isMergeOpen}
                onClose={() => setIsMergeOpen(false)}
                target={user}
                users={users}
                onMerged={async () => {
                    // Раньше после склейки просили «Обновите страницу» —
                    // теперь сами подтягиваем баланс, брони и сумму оплат.
                    await Promise.all([fetchUsers(), reloadUserBookings(user.email), reloadTotalPaid()]);
                }}
            />

            {/* Header */}
            {
                <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 16, marginBottom: 28 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                        <button onClick={() => navigate(window.location.pathname.startsWith('/m/admin') ? '/m/admin/users' : '/admin/users')}
                            aria-label="Назад к списку клиентов"
                            style={{ padding: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60, marginTop: 4 }}>
                            <ArrowLeft size={18} />
                        </button>
                        <div style={{ flex: 1 }}>
                            <p style={{ ...ghudMono, color: GH.ink60, marginBottom: 6 }}>Карточка клиента</p>
                            {isEditingName ? (
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                    <input
                                        autoFocus
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onKeyDown={async (e) => {
                                            if (e.key === 'Escape') { setIsEditingName(false); return; }
                                            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                                        }}
                                        placeholder="Имя для расписания (например: Галина Иващенко)"
                                        style={{
                                            flex: 1,
                                            fontSize: 'clamp(20px, 2.6vw, 30px)',
                                            fontWeight: 700,
                                            letterSpacing: '-0.02em',
                                            padding: '4px 8px',
                                            border: `1px solid ${GH.ink}`,
                                            background: GH.paper,
                                            fontFamily: GH_SANS,
                                            outline: 'none',
                                        }}
                                    />
                                    <button
                                        onClick={async () => {
                                            const trimmed = editName.trim();
                                            if (!trimmed || trimmed === user.name || savingName) {
                                                setIsEditingName(false);
                                                return;
                                            }
                                            setSavingName(true);
                                            try {
                                                const { usersApi } = await import('../../api/users');
                                                await usersApi.updateUser(user.id, { name: trimmed });
                                                toast.success('Имя обновлено');
                                                await useUserStore.getState().fetchUsers();
                                                setIsEditingName(false);
                                            } catch (err: any) {
                                                toast.error(err?.response?.data?.detail || 'Не удалось сохранить');
                                            } finally {
                                                setSavingName(false);
                                            }
                                        }}
                                        disabled={savingName}
                                        title="Сохранить"
                                        style={{ padding: 8, background: GH.ink, color: GH.paper, border: 'none', cursor: savingName ? 'wait' : 'pointer' }}
                                    >
                                        {savingName ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                    </button>
                                    <button
                                        onClick={() => setIsEditingName(false)}
                                        title="Отмена"
                                        style={{ padding: 8, background: 'transparent', color: GH.ink60, border: `1px solid ${GH.ink10}`, cursor: 'pointer' }}
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            ) : (
                                <h1 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1, margin: 0, marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                                    <span>{user.name || '(без имени)'}</span>
                                    <button
                                        onClick={() => { setEditName(user.name || ''); setIsEditingName(true); }}
                                        title="Изменить отображаемое имя (для расписания)"
                                        style={{ padding: 4, background: 'transparent', border: 'none', color: GH.ink60, cursor: 'pointer', display: 'inline-flex' }}
                                    >
                                        <Pencil size={14} />
                                    </button>
                                </h1>
                            )}
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ ...ghudMono, fontSize: 12, padding: '3px 8px', background: GH.ink5, color: GH.ink60 }}>
                                    {ROLE_LABEL[user.role || 'user'] || 'Клиент'}
                                </span>
                                {/* Этап клиента — не статус брони, поэтому без цвета статуса. */}
                                <span style={{ ...ghudMono, fontSize: 12, padding: '3px 8px', background: GH.ink5, color: GH.ink80 }}>
                                    {currentStatusConfig.label}
                                </span>
                                {user.email && <span style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60 }}>{user.email}</span>}
                                {user.registrationDate && (() => {
                                    // Defensive: after /users/merge the target user may
                                    // carry over a malformed registrationDate from the
                                    // absorbed account — don't let it crash the page.
                                    const formatted = safeFormat(user.registrationDate, 'd.MM.yyyy');
                                    if (!formatted) return null;
                                    return (
                                        <span style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60 }}>
                                            с {formatted}
                                        </span>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            }

            {/* Tabs — раньше 4 кнопки с padding 18px не влезали на узкий
                мобильный экран, правые БРОНИРОВАНИЯ/ФИНАНСЫ/ИСТОРИЯ
                уезжали за край и не тапались. Фикс: горизонтальный скролл +
                компактнее padding на мобильном (фактически tabs shrink to
                content и scroll если всё равно не влезает). */}
            {
                <div style={{
                    display: 'flex',
                    gap: 0,
                    borderBottom: `1px solid ${GH.ink10}`,
                    marginBottom: 24,
                    overflowX: 'auto',
                    WebkitOverflowScrolling: 'touch',
                    scrollbarWidth: 'thin',
                }}>
                    {([
                        ['overview', 'ОБЗОР'],
                        ['bookings', 'БРОНИРОВАНИЯ'],
                        ['finance', 'ФИНАНСЫ'],
                        ['timeline', 'ИСТОРИЯ'],
                    ] as const).map(([key, label]) => (
                        <button key={key} onClick={() => setActiveTab(key as any)}
                            style={{
                                padding: '10px 14px', border: 'none', cursor: 'pointer',
                                fontFamily: GH_SANS, fontSize: 12, fontWeight: 600,
                                background: 'transparent',
                                color: activeTab === key ? GH.ink : GH.ink60,
                                borderBottom: activeTab === key ? `2px solid ${GH.ink}` : '2px solid transparent',
                                marginBottom: -1, letterSpacing: '0.04em',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                            }}>
                            {label}
                        </button>
                    ))}
                </div>
            }

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Profile & Info */}
                <div className="space-y-6">
                    {/* Main Info Card */}
                    <Card className="p-6">
                        <div className="flex flex-col items-center text-center mb-6">
                            <div className="relative group">
                                <div className="w-24 h-24 rounded-full overflow-hidden bg-unbox-light/50 flex items-center justify-center text-3xl font-bold text-ink-60 mb-4 border-2 border-transparent group-hover:border-unbox-light transition-all">
                                    {user.avatarUrl ? (
                                        <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                                    ) : (
                                        (user.name || '?').charAt(0).toUpperCase()
                                    )}
                                </div>
                                <label className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 rounded-full cursor-pointer transition-opacity">
                                    <span className="text-xs font-medium">Изменить</span>
                                    <input
                                        type="file"
                                        className="hidden"
                                        accept="image/*"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                const reader = new FileReader();
                                                reader.onloadend = () => {
                                                    updateUserById(user.email, { avatarUrl: reader.result as string });
                                                    toast.success('Фото обновлено');
                                                };
                                                reader.readAsDataURL(file);
                                            }
                                        }}
                                    />
                                </label>
                            </div>
                            <div className="font-bold text-lg">{user.name}</div>
                            <div className={clsx("text-sm px-2 py-0.5 rounded-full mt-1",
                                user.level === 'vip' ? 'bg-sunken text-ink-80' :
                                    user.level === 'loyal' ? 'bg-unbox-light text-unbox-dark' :
                                        'bg-gray-100 text-ink-80'
                            )}>
                                {user.level === 'vip' ? 'VIP' : user.level === 'loyal' ? 'Постоянный' : 'Базовый'}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center gap-3 text-sm">
                                <Mail size={16} className="text-ink-60" />
                                <a href={`mailto:${user.email}`} className="text-unbox-green hover:underline">{user.email}</a>
                            </div>
                            {/* Телефон. Аудит G7-21: раньше нажатие на номер открывало
                                prompt() правки, и на телефоне админ вместо звонка случайно
                                менял номер. Теперь номер — ссылка tel:, правка — кнопкой. */}
                            <div className="flex items-center gap-3 text-sm">
                                <Phone size={16} className="text-ink-60" />
                                {user.phone ? (
                                    <a href={`tel:${user.phone.replace(/[^+\d]/g, '')}`} className="text-unbox-dark hover:underline">
                                        {user.phone}
                                    </a>
                                ) : (
                                    <span className="text-ink-60">Не указан</span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setEditField('phone')}
                                    className="ml-auto inline-flex items-center gap-1 text-xs text-ink-60 hover:text-ink min-h-[32px] px-1"
                                    aria-label="Изменить телефон"
                                >
                                    <Pencil size={12} aria-hidden="true" /> Изменить
                                </button>
                            </div>

                            {/* Telegram Field — принимает @username ИЛИ числовой
                                chat_id. На вводе с @ резолвим через бэкенд
                                (Telegram getChat). Если бот ещё не виделся
                                с пользователем (нет общего чата) — выдадим
                                админу понятный текст что нужно сделать. */}
                            <div className="flex items-center gap-3 text-sm">
                                <div className="text-ink-60"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-send"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg></div>
                                <span className={user.telegramId ? 'text-unbox-dark' : 'text-ink-60'}>
                                    {user.telegramId || 'Telegram не указан'}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setEditField('telegram')}
                                    className="ml-auto inline-flex items-center gap-1 text-xs text-ink-60 hover:text-ink min-h-[32px] px-1"
                                    aria-label="Изменить Telegram"
                                >
                                    <Pencil size={12} aria-hidden="true" /> Изменить
                                </button>
                            </div>

                            {/* Profession Field */}
                            <div className="pt-2 border-t border-gray-100">
                                <div className="text-xs text-ink-60 mb-1">Профессия</div>
                                <ProfessionEditor
                                    value={user.profession}
                                    onChange={(val) => updateUserById(user.email, { profession: val })}
                                />
                            </div>

                            {/* Target Audience Field */}
                            <div className="pt-2 border-t border-gray-100">
                                <div className="text-xs text-ink-60 mb-1">Работает с</div>
                                <TargetAudienceEditor
                                    value={user.targetAudience}
                                    onChange={(val) => updateUserById(user.email, { targetAudience: val })}
                                />
                            </div>
                        </div>

                        <div className="border-t border-unbox-light my-4 pt-4 space-y-3">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-ink-60">Первый визит</span>
                                <span className="font-medium text-unbox-dark">
                                    {formatDayMonth(firstBookingDate, { withYear: true })}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-ink-60">Последний визит</span>
                                <span className="font-medium text-unbox-dark">
                                    {formatDayMonth(lastVisitDate, { withYear: true })}
                                </span>
                            </div>
                        </div>

                        {/* ── Admin Assignment ── */}
                        <div className="border-t border-unbox-light pt-4 space-y-1">
                            <div className="text-xs font-semibold text-ink-60 uppercase tracking-wider mb-3">Назначения</div>

                            {/* Responsible row */}
                            <button
                                onClick={() => setAdminPickerType('responsible')}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-unbox-light/50 transition-colors text-left"
                            >
                                <div className={clsx(
                                    'w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold',
                                    responsibleAdmin ? 'bg-unbox-green text-white' : 'bg-unbox-light text-ink-60'
                                )}>
                                    {responsibleAdmin ? (responsibleAdmin.name?.[0]?.toUpperCase() ?? '?') : <UserCircle size={14} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-caption text-ink-60">Ответственный</div>
                                    <div className={clsx('text-sm font-medium truncate', responsibleAdmin ? 'text-unbox-dark' : 'text-ink-60 italic')}>
                                        {responsibleAdmin ? responsibleAdmin.name : 'не назначен'}
                                    </div>
                                </div>
                                <Pencil size={12} className="text-ink-60 shrink-0" aria-hidden="true" />
                            </button>

                            {/* Attracted row */}
                            <button
                                onClick={() => setAdminPickerType('attracted')}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-unbox-light/50 transition-colors text-left"
                            >
                                <div className={clsx(
                                    'w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold',
                                    attractedAdmin ? 'bg-ink-60 text-white' : 'bg-unbox-light text-ink-60'
                                )}>
                                    {attractedAdmin ? (attractedAdmin.name?.[0]?.toUpperCase() ?? '?') : <UserCircle size={14} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-caption text-ink-60">Привлёк клиента</div>
                                    <div className={clsx('text-sm font-medium truncate', attractedAdmin ? 'text-unbox-dark' : 'text-ink-60 italic')}>
                                        {attractedAdmin ? attractedAdmin.name : 'не указан'}
                                    </div>
                                </div>
                                <Pencil size={12} className="text-ink-60 shrink-0" aria-hidden="true" />
                            </button>
                        </div>

                        {/* ── Password Change ── */}
                        {(currentUser?.role === 'owner' || currentUser?.role === 'senior_admin') && (
                            <div className="border-t border-unbox-light pt-4">
                                <div className="text-xs font-semibold text-ink-60 uppercase tracking-wider mb-3">Безопасность</div>
                                <button
                                    // Excel #46 — «Сбросить пароль» (админ задаёт новый без старого).
                                    // Аудит 29.09: окно со скрытым полем и показом пароля один раз
                                    // вместо двух prompt() с паролем открытым текстом.
                                    onClick={() => setIsResetPasswordOpen(true)}
                                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-ink-05 border border-dashed border-ink-20 transition-colors text-left"
                                >
                                    <div className="w-7 h-7 rounded-full bg-sunken flex items-center justify-center text-ink-80 shrink-0">
                                        <Shield size={14} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-unbox-dark">Сбросить пароль</div>
                                        <div className="text-caption text-ink-60">Админ-override без старого пароля. Записывается в журнал.</div>
                                    </div>
                                </button>

                                {/* Change email (Excel #47) — senior_admin/owner only */}
                                {(currentUser?.role === 'senior_admin' || currentUser?.role === 'owner') && (
                                    <button
                                        onClick={() => setEditField('email')}
                                        className="mt-2 w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-ink-05 border border-dashed border-ink-20 transition-colors text-left"
                                    >
                                        <div className="w-7 h-7 rounded-full bg-sunken flex items-center justify-center text-ink-80 shrink-0">
                                            <Shield size={14} />
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-unbox-dark">Изменить email</div>
                                            <div className="text-caption text-ink-60">Каскадно обновляет брони, waitlist и транзакции</div>
                                        </div>
                                    </button>
                                )}

                                {/* Archive / Unarchive — Excel #11 soft delete.
                                    Available to any admin role; the backend
                                    enforces hierarchy (admins can't archive
                                    each other, nobody can archive owner). */}
                                <button
                                    onClick={async () => {
                                        if (!user.archivedAt) { setEditField('archive'); return; }
                                        const ok = await confirm({
                                            title: 'Вернуть из архива?',
                                            body: `${user.email} снова сможет входить на сайт и появится в обычных списках.`,
                                            confirmLabel: 'Вернуть из архива',
                                            cancelLabel: 'Оставить в архиве',
                                        });
                                        if (!ok) return;
                                        try {
                                            const { usersApi } = await import('../../api/users');
                                            await usersApi.unarchiveUser(user.id);
                                            toast.success('Пользователь восстановлен');
                                            await useUserStore.getState().fetchUsers();
                                        } catch (err: any) {
                                            toast.error(err.response?.data?.detail || 'Не удалось восстановить');
                                        }
                                    }}
                                    className="mt-2 w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-ink-05 border border-dashed border-ink-20 transition-colors text-left"
                                >
                                    <div className="w-7 h-7 rounded-full bg-sunken flex items-center justify-center text-ink-80 shrink-0">
                                        <Shield size={14} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-unbox-dark">
                                            {user.archivedAt ? 'Восстановить из архива' : 'Архивировать пользователя'}
                                        </div>
                                        <div className="text-caption text-ink-60">
                                            {user.archivedAt
                                                ? `В архиве с ${safeFormat(user.archivedAt, 'd.MM.yyyy', undefined, '—')}`
                                                : 'Заблокирует вход, сохранит всю историю. Обратимо.'}
                                        </div>
                                    </div>
                                </button>

                                {/* Merge two accounts — senior_admin/owner only */}
                                {(currentUser?.role === 'senior_admin' || currentUser?.role === 'owner') && (
                                    <button
                                        // Аудит 29.09: раньше email дубликата вводили вслепую в prompt().
                                        // Теперь поиск + предпросмотр обоих аккаунтов до подтверждения.
                                        onClick={() => setIsMergeOpen(true)}
                                        className="mt-2 w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-ink-05 border border-dashed border-ink-20 transition-colors text-left"
                                    >
                                        <div className="w-7 h-7 rounded-full bg-sunken flex items-center justify-center text-ink-80 shrink-0">
                                            <Shield size={14} />
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-unbox-dark">Слить с аккаунтом</div>
                                            <div className="text-caption text-ink-60">Объединить дубликаты (TG-placeholder + сайт)</div>
                                        </div>
                                    </button>
                                )}
                            </div>
                        )}
                    </Card>

                    {/* ── Admin Picker Modal (fixed, escapes overflow:hidden) ── */}
                    {adminPickerType && (
                        <div
                            className="fixed inset-0 z-50 flex items-center justify-center"
                            onClick={() => setAdminPickerType(null)}
                        >
                            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
                            <div
                                className="relative bg-white rounded-2xl shadow-2xl w-72 p-5 animate-in zoom-in-95 duration-200"
                                onClick={e => e.stopPropagation()}
                            >
                                {/* Modal header */}
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <h3 className="font-bold text-unbox-dark">
                                            {adminPickerType === 'responsible' ? 'Ответственный менеджер' : 'Кто привлёк клиента'}
                                        </h3>
                                        <p className="text-xs text-ink-60 mt-0.5">{user.name}</p>
                                    </div>
                                    <button onClick={() => setAdminPickerType(null)} className="p-1 rounded-lg hover:bg-unbox-light text-ink-60">
                                        <X size={16} />
                                    </button>
                                </div>

                                <div className="space-y-1">
                                    {/* Clear option */}
                                    <button
                                        onClick={() => {
                                            const field = adminPickerType === 'responsible' ? { responsibleAdminId: null } : { attractedByAdminId: null };
                                            updateUserById(user.email, field as any);
                                            setAdminPickerType(null);
                                        }}
                                        className={clsx(
                                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-left',
                                            (adminPickerType === 'responsible' ? !user.responsibleAdminId : !user.attractedByAdminId)
                                                ? 'bg-unbox-light text-unbox-dark font-medium'
                                                : 'text-ink-60 hover:bg-unbox-light/50'
                                        )}
                                    >
                                        <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                                            <UserCircle size={16} className="text-ink-60" />
                                        </div>
                                        {adminPickerType === 'responsible' ? 'Не назначен' : 'Не указан'}
                                    </button>

                                    {/* Admin list */}
                                    {adminUsers.map(admin => {
                                        const currentId = adminPickerType === 'responsible' ? user.responsibleAdminId : user.attractedByAdminId;
                                        const isSelected = currentId === admin.id;
                                        const avatarBg = adminPickerType === 'responsible' ? 'bg-unbox-green' : 'bg-ink-60';
                                        return (
                                            <button
                                                key={admin.id}
                                                onClick={() => {
                                                    const field = adminPickerType === 'responsible'
                                                        ? { responsibleAdminId: admin.id }
                                                        : { attractedByAdminId: admin.id };
                                                    updateUserById(user.email, field as any);
                                                    toast.success(adminPickerType === 'responsible' ? `Ответственный: ${admin.name}` : `Привлёк: ${admin.name}`);
                                                    setAdminPickerType(null);
                                                }}
                                                className={clsx(
                                                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-left',
                                                    isSelected ? 'bg-unbox-green text-white font-medium' : 'text-unbox-dark hover:bg-unbox-light/50'
                                                )}
                                            >
                                                <div className={clsx(
                                                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                                                    isSelected ? 'bg-white/20 text-white' : `${avatarBg} text-white`
                                                )}>
                                                    {admin.name?.[0]?.toUpperCase() ?? '?'}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate">{admin.name}</div>
                                                    <div className={clsx('text-caption truncate', isSelected ? 'text-white/70' : 'text-ink-60')}>
                                                        {admin.role === 'owner' ? 'Владелец' : admin.role === 'senior_admin' ? 'Ст. Администратор' : 'Администратор'}
                                                    </div>
                                                </div>
                                                {isSelected && <UserCheck size={14} className="ml-auto shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Contacts */}
                    <UserContacts email={user.email} contacts={user.additionalContacts || []} />



                    {/* Tags */}
                    <UserTags email={user.email} tags={user.tags || []} />

                    {/* Comments & Notes */}
                    <UserComments email={user.email} />
                    <UserBonuses user={user} currentUser={currentUser!} />
                </div>

                {/* Middle Column: Finances & Subscription & Tabs */}
                <div className="space-y-6 lg:col-span-2">
                    {/* Overview Tab Content */}
                    {activeTab === 'overview' && (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            {/* CRM Access — показываем ВВЕРХУ если есть запрос требующий действия */}
                            {crmAccess && ['pending', 'expired', 'rejected'].includes(crmAccess.accessStatus) && (
                                <Card className={clsx("p-5 border-2", crmAccess.accessStatus === 'pending' ? 'border-[color:var(--status-pending-fg)] bg-[color:var(--status-pending-bg)]' : 'border-[color:var(--status-danger-bg)] bg-[color:var(--status-danger-bg)]')}>
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="font-bold text-base flex items-center gap-2">
                                            <KeyRound size={18} className={crmAccess.accessStatus === 'pending' ? 'text-[color:var(--status-pending-fg)]' : 'text-[color:var(--status-danger-fg)]'} />
                                            Запрос на Psy-CRM
                                        </h3>
                                        {crmAccess.accessStatus === 'pending' && (
                                            <span className="px-2.5 py-1 rounded-full bg-[color:var(--status-pending-bg)] text-[color:var(--status-pending-fg)] text-caption font-bold uppercase flex items-center gap-1 animate-pulse">
                                                <Clock size={12} />
                                                Ожидает решения
                                            </span>
                                        )}
                                        {crmAccess.accessStatus === 'expired' && (
                                            <span className="px-2.5 py-1 rounded-full bg-[color:var(--status-danger-bg)] text-[color:var(--status-danger-fg)] text-caption font-bold uppercase">
                                                Истёк
                                            </span>
                                        )}
                                        {crmAccess.accessStatus === 'rejected' && (
                                            <span className="px-2.5 py-1 rounded-full bg-[color:var(--status-danger-bg)] text-[color:var(--status-danger-fg)] text-caption font-bold uppercase">
                                                Отклонён
                                            </span>
                                        )}
                                    </div>
                                    <div className="space-y-3">
                                        {crmAccess.profession && (
                                            <div className="text-sm">
                                                <span className="text-ink-60">Профессия:</span>{' '}
                                                <span className="font-medium">{crmAccess.profession}</span>
                                            </div>
                                        )}
                                        {crmAccess.message && (
                                            <div className="text-sm">
                                                <span className="text-ink-60">Сообщение:</span>{' '}
                                                <span className="text-ink-80">{crmAccess.message}</span>
                                            </div>
                                        )}
                                        {crmAccess.submittedAt && (
                                            <div className="text-xs text-ink-60">
                                                Подано: {formatDayMonth(crmAccess.submittedAt, { withYear: 'auto' })}, {formatTime(crmAccess.submittedAt)}
                                            </div>
                                        )}
                                        <div className="flex flex-wrap gap-2 pt-2">
                                            {crmAccess.accessStatus === 'pending' && (
                                                <>
                                                    <button
                                                        onClick={() => handleCrmApprove(30)}
                                                        disabled={crmActionLoading}
                                                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                                                    >
                                                        {crmActionLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                                        Одобрить на 30 дней
                                                    </button>
                                                    <button
                                                        onClick={() => handleCrmReject()}
                                                        disabled={crmActionLoading}
                                                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[color:var(--status-danger-bg)] text-[color:var(--status-danger-fg)] text-sm font-semibold hover:bg-[color:var(--status-danger-bg)] disabled:opacity-50 transition-colors"
                                                    >
                                                        <XCircle size={14} />
                                                        Отклонить
                                                    </button>
                                                </>
                                            )}
                                            {(crmAccess.accessStatus === 'expired' || crmAccess.accessStatus === 'rejected') && (
                                                <button
                                                    onClick={() => handleCrmApprove(30)}
                                                    disabled={crmActionLoading}
                                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                                                >
                                                    {crmActionLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                                    Активировать на 30 дней
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </Card>
                            )}

                            <Card className="p-6">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="font-bold text-lg flex items-center gap-2">
                                        <CreditCard size={20} className="text-ink-60" />
                                        Финансы и Статистика
                                    </h3>
                                    <div className="flex gap-2">
                                        <Button size="sm" variant="outline" onClick={() => setIsAddFundsOpen(true)}>
                                            <Plus size={16} className="mr-2" />
                                            Пополнить
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => setIsAssignSubOpen(true)}>
                                            <RotateCcw size={16} className="mr-2" />
                                            Абонемент
                                        </Button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {/* 1. Общая сумма оплат (Real Money In) */}
                                    <div className="bg-unbox-light/30 rounded-xl p-4 border border-unbox-light">
                                        <div className="text-sm text-ink-60 mb-1">Общая сумма оплат</div>
                                        <div className="text-2xl font-bold">
                                            {totalPaid !== null ? formatGel(totalPaid) : '—'}
                                        </div>
                                        <div
                                            className="text-xs text-ink-60 mt-1 flex items-center gap-1.5 cursor-pointer group/balance"
                                            // Право finance.balance_correction (решение владельца 27.08):
                                            // без него бэк вернёт 403 — не дразним кликабельностью.
                                            onClick={() => {
                                                if (!hasPermission(currentUser, 'finance.balance_correction')) {
                                                    toast.error('Корректировка баланса — только для старших администраторов');
                                                    return;
                                                }
                                                setIsBalanceCorrectionOpen(true);
                                            }}
                                            title="Скорректировать баланс (вручную, с указанием причины)"
                                        >
                                            <Wallet size={11} className="text-ink-60 group-hover/balance:text-unbox-green transition-colors" />
                                            <span>Баланс: <span className="font-semibold border-b border-dashed border-unbox-light group-hover/balance:border-unbox-green group-hover/balance:text-unbox-green transition-colors">{formatGel(user.balance)}</span></span>
                                        </div>
                                        {/* Credit Limit UI */}
                                        <div
                                            className="text-xs text-ink-60 mt-1 flex items-center gap-1 group/limit cursor-pointer"
                                            onClick={() => setIsEditLimitOpen(true)}
                                        >
                                            Кредитный лимит:
                                            <span className="font-semibold text-ink-60 border-b border-dashed border-unbox-light group-hover/limit:border-ink group-hover/limit:text-unbox-green transition-colors">
                                                {formatGel(user.creditLimit || 0)}
                                            </span>
                                            <div className="bg-unbox-light/50 p-0.5 rounded opacity-0 group-hover/limit:opacity-100 transition-opacity">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 2. Всего забронировано часов */}
                                    <div className="bg-unbox-light/30 rounded-xl p-4 border border-unbox-light">
                                        <div className="text-sm text-ink-60 mb-1">Всего часов</div>
                                        <div className="text-2xl font-bold">
                                            {bookingsLoading ? '…' : userBookings
                                                .filter(b => b.status === 'completed' || b.status === 'confirmed')
                                                .reduce((sum, b) => sum + (b.duration / 60), 0)
                                                .toFixed(1)} ч
                                        </div>
                                        <div className="text-xs text-ink-60 mt-1">
                                            {bookingsLoading ? '…' : sortedBookings.length} бронирований
                                        </div>
                                    </div>

                                    {/* 3. Средний чек */}
                                    <div className="bg-unbox-light/30 rounded-xl p-4 border border-unbox-light">
                                        <div className="text-sm text-ink-60 mb-1">Средний чек</div>
                                        <div className="text-2xl font-bold">
                                            {(() => {
                                                const completed = userBookings.filter(b => b.status === 'completed');
                                                if (completed.length === 0) return formatGel(0);
                                                const totalValue = completed.reduce((sum, b) => sum + b.finalPrice, 0);
                                                return formatGel(totalValue / completed.length, { fraction: 0 });
                                            })()}
                                        </div>
                                        <div className="text-xs text-ink-60 mt-1">за посещение</div>
                                    </div>

                                    {/* 5. Активный абонемент */}
                                    <div className={clsx("rounded-xl p-4 border relative overflow-hidden col-span-1 md:col-span-2 lg:col-span-3", user.subscription ? "bg-sunken border-ink-10" : "bg-unbox-light/30 border-unbox-light")}>
                                        <div className="relative z-10 flex justify-between items-start">
                                            <div>
                                                {/* Заголовок следует РЕАЛЬНОМУ статусу. Раньше здесь было
                                                    жёстко зашито «Активный абонемент», и у завершённого
                                                    выходило «Активный» рядом с плашкой «ЗАВЕРШЁН». */}
                                                <div className="text-sm text-ink-60 mb-1">
                                                    {SUB_TITLE[subscriptionLifecycle(user.subscription as any)]}
                                                </div>
                                                {user.subscription ? (
                                                    <>
                                                        <div className="text-xl font-bold text-ink-80 mb-1">{user.subscription.name}</div>
                                                        <div className="text-sm text-ink-80 font-mono">
                                                            {subscriptionLifecycle(user.subscription as any) === 'completed'
                                                                ? <>Использовано: <b>{(user.subscription.totalHours + (user.subscription.bonusHours || 0)) - user.subscription.remainingHours}</b> / {user.subscription.totalHours + (user.subscription.bonusHours || 0)} ч</>
                                                                : <>Остаток: <b>{user.subscription.remainingHours}</b> / {user.subscription.totalHours + (user.subscription.bonusHours || 0)} ч</>}
                                                        </div>
                                                        <button
                                                            onClick={() => setIsTopupOpen(o => !o)}
                                                            className="mt-2 flex items-center gap-1 text-xs text-ink-80 hover:text-ink underline"
                                                        >
                                                            <PackagePlus size={11} />
                                                            Пополнить часы
                                                        </button>
                                                    </>
                                                ) : (
                                                    <div className="text-ink-60 italic">Отсутствует</div>
                                                )}
                                            </div>
                                            {user.subscription && (
                                                <div className="text-right">
                                                    {(() => {
                                                        const badge = subscriptionBadge(user.subscription as any);
                                                        return (
                                                            <div className={clsx("px-2 py-0.5 rounded text-caption font-bold uppercase mb-2 inline-block", badge.cls)}>
                                                                {badge.label}
                                                            </div>
                                                        );
                                                    })()}
                                                    <div className="text-xs text-ink-80">
                                                        {isEditingExpiry ? (
                                                            <div className="flex items-center gap-1.5 mt-1">
                                                                <input
                                                                    type="date"
                                                                    value={editExpiryDate}
                                                                    onChange={e => setEditExpiryDate(e.target.value)}
                                                                    className="rounded border border-ink-20 px-1.5 py-0.5 text-xs focus:outline-none focus:border-ink"
                                                                />
                                                                <button
                                                                    onClick={() => {
                                                                        if (!editExpiryDate) return;
                                                                        const updated = { ...user.subscription!, expiryDate: new Date(editExpiryDate).toISOString() };
                                                                        updateUserById(user.email, { subscription: updated as any });
                                                                        toast.success('Дата абонемента обновлена');
                                                                        setIsEditingExpiry(false);
                                                                    }}
                                                                    className="text-[color:var(--status-ok-fg)] hover:text-ink font-bold text-xs"
                                                                    aria-label="Сохранить дату"
                                                                >
                                                                    <Check size={14} aria-hidden="true" />
                                                                </button>
                                                                <button
                                                                    onClick={() => setIsEditingExpiry(false)}
                                                                    className="text-ink-60 hover:text-ink text-xs"
                                                                    aria-label="Не менять дату"
                                                                >
                                                                    <X size={14} aria-hidden="true" />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => {
                                                                    const iso = safeFormat(user.subscription!.expiryDate, 'yyyy-MM-dd');
                                                                    if (iso) setEditExpiryDate(iso);
                                                                    setIsEditingExpiry(true);
                                                                }}
                                                                className="hover:text-ink underline decoration-dotted"
                                                            >
                                                                до {safeFormat(user.subscription.expiryDate, 'd.MM.yyyy', undefined, '—')}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {(() => {
                                                        // Состояние паузы видно сразу: на паузе ли, до какого числа,
                                                        // использована ли. Раньше кнопка была всегда активна, и админы
                                                        // жали «Заморозить» по 17 раз, получая отказ.
                                                        const sub = user.subscription!;
                                                        const until = sub.isFrozen && sub.frozenUntil ? new Date(sub.frozenUntil) : null;
                                                        const over = !!until && until.getTime() < Date.now();
                                                        const used = !sub.isFrozen && (sub.freezeCount || 0) >= 1;
                                                        return (
                                                            <div className="mt-2 space-y-1">
                                                                {sub.isFrozen && (
                                                                    <div className={clsx('text-xs font-medium inline-flex items-start gap-1', over ? 'text-[color:var(--status-pending-fg)]' : 'text-[color:var(--status-info-fg)]')}>
                                                                        {over && <AlertTriangle size={12} className="shrink-0 mt-0.5" aria-hidden="true" />}
                                                                        {over
                                                                            ? `Пауза закончилась ${safeFormat(sub.frozenUntil, 'd.MM')}, но не снята — брони идут с баланса, а не часами`
                                                                            : `На паузе до ${safeFormat(sub.frozenUntil, 'd.MM')} — брони идут с баланса`}
                                                                    </div>
                                                                )}
                                                                {used ? (
                                                                    <div className="text-xs text-ink-60">Пауза по этому абонементу уже использована</div>
                                                                ) : (
                                                                    <button
                                                                        onClick={toggleFreeze}
                                                                        className={clsx('text-xs underline hover:text-ink', over ? 'text-[color:var(--status-pending-fg)] font-semibold' : 'text-ink-80')}
                                                                    >
                                                                        {sub.isFrozen ? 'Снять паузу' : 'Поставить на паузу (7 дней, один раз)'}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            )}
                                        </div>

                                        {/* ── Topup inline form ─────────────────────────── */}
                                        {isTopupOpen && (
                                            <div className="relative z-10 mt-4 border-t border-ink-10 pt-4">
                                                <div className="text-xs font-semibold text-ink-80 mb-3">Пополнение абонемента</div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="text-caption text-ink-60 block mb-1">Часов</label>
                                                        <input
                                                            type="number"
                                                            value={topupForm.hours}
                                                            onChange={e => setTopupForm(f => ({ ...f, hours: e.target.value }))}
                                                            className="w-full rounded-lg border border-ink-10 bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-ink"
                                                            min="1"
                                                            placeholder="10"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-caption text-ink-60 block mb-1">Сумма (₾)</label>
                                                        <input
                                                            type="number"
                                                            value={topupForm.amount}
                                                            onChange={e => setTopupForm(f => ({ ...f, amount: e.target.value }))}
                                                            className="w-full rounded-lg border border-ink-10 bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-ink"
                                                            min="0"
                                                            placeholder="150"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3 mt-2">
                                                    <div>
                                                        <label className="text-caption text-ink-60 block mb-1">Способ оплаты</label>
                                                        <select
                                                            value={topupForm.payment_method}
                                                            onChange={e => setTopupForm(f => ({ ...f, payment_method: e.target.value }))}
                                                            className="w-full rounded-lg border border-ink-10 bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-ink"
                                                        >
                                                            <option value="cash">Наличные</option>
                                                            <option value="card">Карта</option>
                                                            <option value="transfer">Перевод</option>
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="text-caption text-ink-60 block mb-1">Заметка</label>
                                                        <input
                                                            type="text"
                                                            value={topupForm.note}
                                                            onChange={e => setTopupForm(f => ({ ...f, note: e.target.value }))}
                                                            className="w-full rounded-lg border border-ink-10 bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-ink"
                                                            placeholder="необязательно"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 mt-3">
                                                    <button
                                                        onClick={() => setIsTopupOpen(false)}
                                                        className="flex-1 py-2 text-sm rounded-xl border border-ink-10 text-ink-80 hover:bg-ink-05 transition-colors"
                                                    >
                                                        Отмена
                                                    </button>
                                                    <button
                                                        onClick={handleTopup}
                                                        disabled={topupSaving || !topupForm.hours || !topupForm.amount}
                                                        className="flex-1 py-2 text-sm rounded-xl bg-ink text-white hover:bg-ink-80 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                                                    >
                                                        {topupSaving && <Loader2 size={14} className="animate-spin" />}
                                                        Подтвердить
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Card>

                            {/* Loyalty System (New) */}
                            <UserLoyaltyCard email={user.email} bookings={userBookings} />

                            {/* CRM Access — показываем внизу только для active (pending/expired/rejected — вверху) */}
                            {crmAccess && crmAccess.accessStatus === 'active' && (
                                <Card className="p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="font-bold text-base flex items-center gap-2">
                                            <KeyRound size={18} className="text-ink-60" />
                                            Доступ к Psy-CRM
                                        </h3>
                                        {crmAccess.permanent ? (
                                            <span className="px-2.5 py-1 rounded-full bg-sunken text-ink-80 text-caption font-bold uppercase">
                                                Постоянный
                                            </span>
                                        ) : (
                                            <span className="px-2.5 py-1 rounded-full bg-[color:var(--status-ok-bg)] text-[color:var(--status-ok-fg)] text-caption font-bold uppercase flex items-center gap-1">
                                                <CheckCircle2 size={12} />
                                                Активен
                                            </span>
                                        )}
                                    </div>
                                    <div className="space-y-3">
                                        {crmAccess.profession && (
                                            <div className="text-sm">
                                                <span className="text-ink-60">Профессия:</span>{' '}
                                                <span className="font-medium text-ink">{crmAccess.profession}</span>
                                            </div>
                                        )}
                                        {!crmAccess.permanent && crmAccess.expiresAt && (
                                            <div className="flex items-center gap-2 text-sm bg-[color:var(--status-ok-bg)] rounded-lg px-3 py-2">
                                                <CalendarClock size={14} className="text-[color:var(--status-ok-fg)]" />
                                                <span className="text-[color:var(--status-ok-fg)]">
                                                    Действует до{' '}
                                                    <b>{formatDayMonth(crmAccess.expiresAt, { withYear: 'auto' })}</b>
                                                    {crmAccess.daysRemaining !== null && (
                                                        <span className="text-[color:var(--status-ok-fg)] ml-1">({crmAccess.daysRemaining} дн.)</span>
                                                    )}
                                                </span>
                                            </div>
                                        )}
                                        {!crmAccess.permanent && (
                                            <div className="flex flex-wrap gap-2 pt-2">
                                                <button
                                                    onClick={() => handleCrmApprove(30)}
                                                    disabled={crmActionLoading}
                                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sunken text-ink-80 text-sm font-semibold hover:bg-ink-05 disabled:opacity-50 transition-colors"
                                                >
                                                    {crmActionLoading ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
                                                    Продлить на 30 дней
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </Card>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                                <div className="space-y-6">
                                    <div className="space-y-6">
                                        <UserBalanceLedger userId={user.id || user.email} />
                                        <UserTransactions email={user.email} />
                                    </div>
                                    <UserTasks email={user.email} tasks={user.adminTasks || []} />
                                </div>

                                <Card className="overflow-hidden h-full flex flex-col">
                                    <div className="p-4 border-b border-unbox-light bg-unbox-light/30 flex items-center gap-2 font-medium">
                                        <History size={16} />
                                        История операций
                                    </div>
                                    <div className="flex-1 overflow-y-auto max-h-[400px]">
                                        {sortedBookings.length === 0 && (
                                            <div className="p-8 text-center text-ink-60 text-sm">История пуста</div>
                                        )}
                                        {sortedBookings.map(item => (
                                            <div
                                                key={item.id}
                                                onClick={() => navigate(`/admin/bookings?search=${item.id}`)}
                                                className="p-4 border-b border-gray-50 hover:bg-unbox-light/30/50 flex items-center justify-between cursor-pointer group"
                                            >
                                                <div>
                                                    <div className="font-medium text-sm group-hover:text-unbox-green transition-colors">
                                                        {RESOURCES.find(r => r.id === item.resourceId)?.name || 'Кабинет'}
                                                    </div>
                                                    <div className="text-xs text-ink-60">
                                                        {formatDayMonth(item.date, { withYear: 'auto' })} · {item.startTime}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className={clsx("font-bold text-sm", item.status === 'cancelled' ? 'text-ink-60 line-through' : '')}>
                                                        {formatGel(-item.finalPrice)}
                                                    </div>
                                                    <div className="text-caption text-ink-60">{statusLabel('booking', item.status, 'staff')}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </Card>
                            </div>
                        </div>
                    )}

                    {/* Bookings Tab Content */}
                    {activeTab === 'bookings' && (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-bold">История бронирований</h2>
                                <Button size="sm" onClick={() => {
                                    useBookingStore.getState().reset();
                                    useBookingStore.getState().setBookingForUser(user.email);
                                    useBookingStore.getState().setStep(2);
                                    navigate('/checkout');
                                }}>
                                    <Plus size={16} className="mr-2" />
                                    Создать бронь
                                </Button>
                            </div>
                            <UserBookingsTab
                                bookings={chronoBookings}
                                onCancel={handleCancelBooking}
                                onReschedule={handleRescheduleBooking}
                                onToSubscription={handleToSubscription}
                                hasActiveSubscription={subscriptionLifecycle(user.subscription) === 'active'}
                                convertingId={convertingId}
                            />
                        </div>
                    )}

                    {/* Finance Tab Content (Extended) */}
                    {activeTab === 'finance' && (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            <div className="flex justify-between items-center">
                                <h2 className="text-xl font-bold">Финансы и Статистика</h2>
                                <div className="flex gap-2">
                                    <Button size="sm" variant="outline" onClick={() => setIsAddFundsOpen(true)}>
                                        <Plus size={16} className="mr-2" />
                                        Пополнить
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setIsAssignSubOpen(true)}>
                                        <RotateCcw size={16} className="mr-2" />
                                        Абонемент
                                    </Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {/* 1. Общая сумма оплат (Real Money In) */}
                                <div className="bg-white rounded-xl p-4 border border-unbox-light shadow-sm">
                                    <div className="text-sm text-ink-60 mb-1">Общая сумма оплат</div>
                                    <div className="text-2xl font-bold">
                                        {totalPaid !== null ? formatGel(totalPaid) : '—'}
                                    </div>
                                    <div className="text-xs text-ink-60 mt-1">Баланс: {formatGel(user.balance)}</div>
                                    {/* Credit Limit UI */}
                                    <div
                                        className="text-xs text-ink-60 mt-1 flex items-center gap-1 group/limit cursor-pointer"
                                        onClick={() => setIsEditLimitOpen(true)}
                                    >
                                        Кредитный лимит:
                                        <span className="font-semibold text-ink-60 border-b border-dashed border-unbox-light group-hover/limit:border-ink group-hover/limit:text-unbox-green transition-colors">
                                            {formatGel(user.creditLimit || 0)}
                                        </span>
                                        <div className="bg-unbox-light/50 p-0.5 rounded opacity-0 group-hover/limit:opacity-100 transition-opacity">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                                        </div>
                                    </div>
                                </div>

                                {/* 2. Всего забронировано часов */}
                                <div className="bg-white rounded-xl p-4 border border-unbox-light shadow-sm">
                                    <div className="text-sm text-ink-60 mb-1">Всего часов</div>
                                    <div className="text-2xl font-bold">
                                        {bookingsLoading ? '…' : userBookings
                                            .filter(b => b.status === 'completed' || b.status === 'confirmed')
                                            .reduce((sum, b) => sum + (b.duration / 60), 0)
                                            .toFixed(1)} ч
                                    </div>
                                    <div className="text-xs text-ink-60 mt-1">
                                        {bookingsLoading ? '…' : sortedBookings.length} бронирований
                                    </div>
                                </div>

                                {/* 3. Средний чек */}
                                <div className="bg-white rounded-xl p-4 border border-unbox-light shadow-sm">
                                    <div className="text-sm text-ink-60 mb-1">Средний чек</div>
                                    <div className="text-2xl font-bold">
                                        {(() => {
                                            const completed = userBookings.filter(b => b.status === 'completed');
                                            if (completed.length === 0) return formatGel(0);
                                            const totalValue = completed.reduce((sum, b) => sum + b.finalPrice, 0);
                                            return formatGel(totalValue / completed.length, { fraction: 0 });
                                        })()}
                                    </div>
                                    <div className="text-xs text-ink-60 mt-1">за посещение</div>
                                </div>
                            </div>

                            <Card className="overflow-hidden">
                                <div className="p-4 border-b border-unbox-light bg-unbox-light/30 font-medium">
                                    История транзакций
                                </div>
                                <div className="p-4">
                                    <div className="space-y-6">
                                        <UserBalanceLedger userId={user.id || user.email} />
                                        <UserTransactions email={user.email} />
                                    </div>
                                </div>
                            </Card>
                        </div>
                    )}

                    {/* Timeline Tab Content */}
                    {activeTab === 'timeline' && (
                        <ClientTimeline
                            user={user}
                            transactions={useUserStore.getState().getTransactionsByUser(user.email)}
                            bookings={userBookings}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

const ROLE_LABEL: Record<string, string> = {
    owner: 'Владелец',
    senior_admin: 'Старший админ',
    admin: 'Администратор',
    specialist: 'Специалист',
    user: 'Клиент',
};

// ── Правка полей клиента: шторка с полем вместо prompt() (wave 1) ──────────
type EditField = 'phone' | 'telegram' | 'email' | 'archive';

function UserFieldSheets({ user, field, onClose, updateUserById, afterEmailChange }: {
    user: { id: string; email: string; phone?: string; telegramId?: string };
    field: EditField | null;
    onClose: () => void;
    updateUserById: (email: string, data: any) => void | Promise<void>;
    afterEmailChange: (next: string) => Promise<void>;
}) {
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!field) return;
        setError(null);
        setBusy(false);
        setValue(field === 'phone' ? (user.phone || '') : field === 'telegram' ? (user.telegramId || '') : field === 'email' ? (user.email || '') : '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [field]);

    const save = async () => {
        const trimmed = value.trim();
        setError(null);
        if (field === 'phone') {
            if (trimmed && !/^[+\d\s()-]+$/.test(trimmed)) {
                setError('Только цифры, пробелы и + ( ) -');
                return;
            }
            updateUserById(user.email, { phone: trimmed || undefined });
            onClose();
            return;
        }
        if (field === 'telegram') {
            if (!trimmed) {
                updateUserById(user.email, { telegramId: '' });
                onClose();
                return;
            }
            // Чистый числовой chat_id сохраняем как есть.
            if (/^-?\d+$/.test(trimmed)) {
                updateUserById(user.email, { telegramId: trimmed });
                toast.success('Telegram ID сохранён');
                onClose();
                return;
            }
            // Иначе — @username: бэкенд узнаёт chat_id через Telegram getChat.
            // Если бот ещё не общался с человеком — бэкенд объяснит, что сделать.
            setBusy(true);
            try {
                const resp = await api.post<{ chat_id: string; name?: string | null }>(
                    '/telegram/resolve-username',
                    { username: trimmed },
                );
                const chatId = resp.data.chat_id;
                updateUserById(user.email, { telegramId: chatId });
                toast.success(
                    resp.data.name
                        ? `Привязан Telegram: ${resp.data.name} (${chatId})`
                        : `Привязан Telegram ID ${chatId}`,
                );
                onClose();
            } catch (e: any) {
                setError(e?.response?.data?.detail || 'Не удалось распознать @username');
            } finally {
                setBusy(false);
            }
            return;
        }
        if (field === 'email') {
            const next = trimmed.toLowerCase();
            if (next === (user.email || '').toLowerCase()) {
                setError('Этот email уже установлен');
                return;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
                setError('Проверьте адрес: нужен вид name@mail.com');
                return;
            }
            setBusy(true);
            try {
                await usersApi.changeEmail(user.id, next);
                toast.success(`Email изменён на ${next}`);
                onClose();
                await afterEmailChange(next);
            } catch (err: any) {
                setError(err?.response?.data?.detail || 'Не удалось сменить email');
            } finally {
                setBusy(false);
            }
            return;
        }
        if (field === 'archive') {
            setBusy(true);
            try {
                await usersApi.archiveUser(user.id, trimmed || undefined);
                toast.success('Пользователь отправлен в архив');
                onClose();
                await useUserStore.getState().fetchUsers();
            } catch (err: any) {
                setError(err?.response?.data?.detail || 'Не удалось архивировать');
            } finally {
                setBusy(false);
            }
        }
    };

    const cfg: Record<EditField, { title: string; description?: string; label: string; hint?: string; kind: InputKind; action: string; danger?: boolean; optional?: boolean; placeholder?: string }> = {
        phone: { title: 'Телефон клиента', label: 'Телефон', hint: 'Например, +995 555 12 34 56. Пусто — удалить номер.', kind: 'phone', action: 'Сохранить телефон', placeholder: '+995 555 12 34 56' },
        telegram: { title: 'Telegram клиента', label: '@username или Telegram ID', hint: 'Пусто — отвязать Telegram.', kind: 'text', action: 'Сохранить Telegram', placeholder: '@username' },
        email: { title: 'Изменить email', description: `Сейчас: ${user.email}. Брони, лист ожидания и операции перейдут на новый адрес автоматически.`, label: 'Новый email', kind: 'email', action: 'Изменить email' },
        archive: { title: 'Архивировать пользователя?', description: `${user.email} не сможет входить на сайт. Брони, оплаты и бонусы сохранятся, вернуть из архива можно в любой момент.`, label: 'Причина (для журнала)', kind: 'text', action: 'Архивировать', danger: true, optional: true },
    };
    const c = field ? cfg[field] : null;

    return (
        <Sheet
            open={!!field}
            onClose={onClose}
            title={c?.title ?? ''}
            description={c?.description}
            width={460}
            footer={c ? (
                <>
                    <UiButton variant={c.danger ? 'danger' : 'primary'} block loading={busy} onClick={save}>
                        {c.action}
                    </UiButton>
                    <UiButton variant="secondary" block onClick={onClose}>
                        Отмена
                    </UiButton>
                </>
            ) : undefined}
        >
            {c && (
                <Field label={c.label} hint={c.hint} error={error} optional={c.optional}>
                    <Input
                        kind={c.kind}
                        value={value}
                        placeholder={c.placeholder}
                        onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
                        autoFocus
                    />
                </Field>
            )}
        </Sheet>
    );
}
