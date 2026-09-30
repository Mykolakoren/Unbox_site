import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Check, Clock, FileText, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../store/userStore';
import { specialistsApi, type SpecialistProfile, type SpecialistApplicationPayload } from '../api/specialists';
import { api, API_URL } from '../api/client';
import { compressImage } from '../utils/imageCompress';
import { COLOR, RADIUS, SPACE, STATUS, TEXT } from '../design/tokens';
import {
    applicationRejectReason,
    applicationStatusOf,
    markSpecialistApplicationSent,
    rememberSpecialistApplicationStatus,
    type SpecialistApplicationStatus,
} from '../hooks/useSpecialistApplication';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getHomePath, getMyBookingsPath } from '../utils/userPaths';
import { canBookCabinets } from '../utils/permissions';
import { catalogPath, useInMobileShell } from '../utils/catalogPath';
import { loginPathWithRedirect } from '../utils/loginRedirect';
import { apiErrorMessage } from '../utils/errors';
import { PublicHeader } from '../components/public/PublicHeader';
import { PageHeader, MobilePageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { Field, Input, Select, TextArea } from '../components/ui/Field';
import { ErrorBar } from '../components/ui/ErrorBar';
import { Skeleton } from '../components/ui/Skeleton';

// Анкета специалиста. Любой вошедший заполняет форму; после отправки запись
// попадает в таблицу Specialist со статусом application_status="pending",
// админ видит её в /admin/specialists и одобряет → is_verified=True →
// карточка в каталоге и право бронировать кабинеты.
//
// Волна 2 (E, находки G1-18, G1-19, X4-05):
//  - /m/become-specialist — внутри мобильной оболочки: без компьютерной
//    шапки, одна колонка, MobilePageHeader со стрелкой «Назад»;
//  - подписи связаны с полями (общий Field), ошибки — под полем, при
//    отправке прокрутка и фокус к первой ошибке;
//  - после отправки — экран «Анкета у администратора» с шагами вместо тоста;
//  - у каждого состояния (нет анкеты / на проверке / отклонена / одобрена)
//    свой понятный следующий шаг.
// Решение владельца 30.09: «Проверим анкету за 1 рабочий день»; цену
// каталога и приветственный час до одобрения не упоминаем.

const ADMIN_TG_URL = 'https://t.me/UnboxCenter';
const REVIEW_TIME = 'Проверим анкету за 1 рабочий день';

const CATEGORIES: Array<{ id: string; label: string }> = [
    { id: 'psychology', label: 'Психология' },
    { id: 'psychiatry', label: 'Психиатрия' },
    { id: 'narcology', label: 'Наркология' },
    { id: 'coaching', label: 'Коучинг' },
    { id: 'education', label: 'Образование' },
];

const FORMATS: Array<{ id: string; label: string }> = [
    { id: 'ONLINE', label: 'Онлайн' },
    { id: 'OFFLINE_PALIASHVILI', label: 'Очно — Палиашвили 4' },
    { id: 'OFFLINE_TBEL', label: 'Очно — Тбел Абусеридзе 38' },
    { id: 'OFFLINE_NEO', label: 'Очно — Neo School' },
];

const EMPTY_FORM: SpecialistApplicationPayload = {
    firstName: '',
    lastName: '',
    photoUrl: '',
    tagline: '',
    bio: '',
    specializations: [],
    formats: [],
    basePriceGel: 0,
    category: 'psychology',
    documents: [],
    instagram: '',
    telegram: '',
    website: '',
};

function formFromProfile(p: SpecialistProfile): SpecialistApplicationPayload {
    return {
        firstName: p.firstName || '',
        lastName: p.lastName || '',
        photoUrl: p.photoUrl || '',
        tagline: p.tagline || '',
        bio: p.bio || '',
        specializations: p.specializations || [],
        formats: p.formats || [],
        basePriceGel: p.basePriceGel || 0,
        category: p.category || 'psychology',
        documents: p.documents || [],
        instagram: p.instagram || '',
        telegram: p.telegram || '',
        website: p.website || '',
    };
}

// Обязательные поля в порядке на экране: к первой ошибке прокручиваем.
type ErrorKey = 'firstName' | 'lastName' | 'documents' | 'formats' | 'basePriceGel';
const ERROR_ORDER: ErrorKey[] = ['firstName', 'lastName', 'documents', 'formats', 'basePriceGel'];
const FIELD_ID: Record<ErrorKey, string> = {
    firstName: 'bs-first-name',
    lastName: 'bs-last-name',
    documents: 'bs-documents',
    formats: 'bs-formats',
    basePriceGel: 'bs-price',
};
type FormErrors = Partial<Record<ErrorKey, string>>;

function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Прокрутить к полю и поставить в него фокус (поле с ошибкой, заголовок экрана). */
function scrollToAndFocus(el: HTMLElement | null) {
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
}

/** В /m прокручивается не окно, а <main data-mobile-scroll> оболочки. */
function scrollPageToTop() {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>('[data-mobile-scroll]')?.scrollTo(0, 0);
}

export function BecomeSpecialistPage() {
    const currentUser = useUserStore(s => s.currentUser);
    const navigate = useNavigate();
    const location = useLocation();
    const inShell = useInMobileShell();
    useDocumentTitle('Анкета специалиста');

    const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
    const [reloadKey, setReloadKey] = useState(0);
    const [profile, setProfile] = useState<SpecialistProfile | null>(null);
    // Правка уже поданной анкеты (на проверке / отклонённой): форма поверх экрана статуса.
    const [editing, setEditing] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [justSubmitted, setJustSubmitted] = useState(false);
    const [form, setForm] = useState<SpecialistApplicationPayload>(EMPTY_FORM);
    const [priceText, setPriceText] = useState('');
    const [specInput, setSpecInput] = useState('');
    const [errors, setErrors] = useState<FormErrors>({});
    const [submitError, setSubmitError] = useState<string | null>(null);
    const statusHeadingRef = useRef<HTMLHeadingElement | null>(null);

    const fillForm = (p: SpecialistProfile | null) => {
        const next = p ? formFromProfile(p) : EMPTY_FORM;
        setForm(next);
        setPriceText(next.basePriceGel > 0 ? String(next.basePriceGel) : '');
        setSpecInput('');
        setErrors({});
        setSubmitError(null);
    };

    const loginPath = loginPathWithRedirect(location.pathname);
    useEffect(() => {
        if (!currentUser) {
            // Без входа — на вход с возвратом сюда же (в /m вход сторожит оболочка).
            navigate(loginPath, { replace: true });
            return;
        }
        let cancelled = false;
        setLoadState('loading');
        specialistsApi.getMine()
            .then(p => {
                if (cancelled) return;
                setProfile(p);
                fillForm(p);
                rememberSpecialistApplicationStatus(currentUser.id, applicationStatusOf(p));
                setLoadState('ready');
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                // Старый бэкенд отвечает роли user 403 — анкету прочитать нельзя,
                // но подать можно: показываем пустую форму, как раньше.
                if ((err as { response?: { status?: number } })?.response?.status === 403) {
                    setProfile(null);
                    fillForm(null);
                    setLoadState('ready');
                    return;
                }
                // Раньше сбой показывал пустую форму — человек с поданной
                // анкетой мог решить, что она пропала, и заполнить заново.
                setLoadState('error');
            });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.id, reloadKey]);

    const status: SpecialistApplicationStatus = applicationStatusOf(profile);
    const canBook = canBookCabinets(currentUser);

    // Анкету одобрили, а роль в сохранённом профиле старая — перечитываем
    // профиль: одобрение сразу даёт право бронировать (решение владельца 30.09).
    useEffect(() => {
        if (loadState === 'ready' && status === 'approved' && !canBook) {
            useUserStore.getState().fetchCurrentUser().catch(() => {});
        }
    }, [loadState, status, canBook]);

    // После отправки — экран статуса с начала, фокус на его заголовок
    // (диктор прочитает «Анкета у администратора»).
    useEffect(() => {
        if (!justSubmitted) return;
        scrollPageToTop();
        statusHeadingRef.current?.focus({ preventScroll: true });
        setJustSubmitted(false);
    }, [justSubmitted]);

    const setField = <K extends keyof SpecialistApplicationPayload>(key: K, value: SpecialistApplicationPayload[K]) => {
        setForm(f => ({ ...f, [key]: value }));
        if ((ERROR_ORDER as string[]).includes(key as string)) {
            setErrors(e => (e[key as ErrorKey] ? { ...e, [key]: undefined } : e));
        }
    };

    const addDocument = (url: string) => {
        setForm(f => ({ ...f, documents: [...f.documents, url] }));
        setErrors(e => (e.documents ? { ...e, documents: undefined } : e));
    };
    const removeDocument = (url: string) =>
        setForm(f => ({ ...f, documents: f.documents.filter(x => x !== url) }));

    const addSpec = () => {
        const v = specInput.trim();
        if (!v) return;
        if (!form.specializations.includes(v)) {
            setForm(f => ({ ...f, specializations: [...f.specializations, v] }));
        }
        setSpecInput('');
    };
    const removeSpec = (s: string) =>
        setForm(f => ({ ...f, specializations: f.specializations.filter(x => x !== s) }));

    const toggleFormat = (id: string) => {
        setForm(f => ({
            ...f,
            formats: f.formats.includes(id) ? f.formats.filter(x => x !== id) : [...f.formats, id],
        }));
        setErrors(e => (e.formats ? { ...e, formats: undefined } : e));
    };

    const validate = (price: number): FormErrors => {
        const next: FormErrors = {};
        if (!form.firstName.trim()) next.firstName = 'Введите имя';
        if (!form.lastName.trim()) next.lastName = 'Введите фамилию';
        if (form.documents.length === 0) next.documents = 'Загрузите диплом или сертификат — без него анкету не проверить';
        if (form.formats.length === 0) next.formats = 'Выберите хотя бы один формат работы';
        if (!(price > 0)) next.basePriceGel = 'Укажите стоимость консультации — больше 0 ₾';
        return next;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError(null);
        const price = parseInt(priceText, 10);
        const found = validate(price);
        setErrors(found);
        const first = ERROR_ORDER.find(k => found[k]);
        if (first) {
            // После отрисовки ошибок — к первому полю с ошибкой.
            requestAnimationFrame(() => scrollToAndFocus(document.getElementById(FIELD_ID[first])));
            return;
        }
        // Специализацию вписали, но не нажали «Добавить» — не теряем её.
        const pendingSpec = specInput.trim();
        const specializations = pendingSpec && !form.specializations.includes(pendingSpec)
            ? [...form.specializations, pendingSpec]
            : form.specializations;
        setSubmitting(true);
        try {
            const result = await specialistsApi.apply({
                ...form,
                specializations,
                basePriceGel: price,
                photoUrl: form.photoUrl?.trim() || undefined,
                tagline: form.tagline?.trim() || '',
                bio: form.bio?.trim() || '',
            });
            setProfile(result);
            fillForm(result);
            // Экраны брони покажут «Анкета на проверке» вместо «заполните анкету».
            markSpecialistApplicationSent(currentUser?.id);
            setEditing(false);
            setJustSubmitted(true);
        } catch (err: unknown) {
            setSubmitError(apiErrorMessage(err, 'Не удалось отправить анкету. Попробуйте ещё раз'));
        } finally {
            setSubmitting(false);
        }
    };

    const cancelEditing = () => {
        fillForm(profile);
        setEditing(false);
        scrollPageToTop();
    };
    const startEditing = () => {
        fillForm(profile);
        setEditing(true);
        scrollPageToTop();
    };

    // Куда вернуться: в /m и с телефона — «Сегодня», на компьютере — свой кабинет.
    const isMobileEntry = inShell || (typeof window !== 'undefined' && (
        !!window.matchMedia?.('(max-width: 768px)').matches
        || !!window.matchMedia?.('(display-mode: standalone)').matches
    ));
    const homePath = isMobileEntry ? '/m/today' : getHomePath(currentUser);
    const bookingPath = inShell ? '/m/find' : getMyBookingsPath(currentUser);
    const crmProfilePath = inShell ? '/m/crm/profile' : '/crm/profile';

    const showForm = loadState === 'ready' && (status === 'none' || (editing && status !== 'approved'));

    // ── Содержимое по состоянию ──────────────────────────────────────────
    let body: ReactNode;
    if (loadState === 'loading' || !currentUser) {
        body = <LoadingBlock />;
    } else if (loadState === 'error') {
        body = (
            <ErrorBar
                message="Не удалось загрузить анкету"
                onRetry={() => setReloadKey(k => k + 1)}
            />
        );
    } else if (showForm) {
        body = (
            <>
                {status === 'none' ? (
                    <>
                        <p style={leadStyle}>
                            Заполните анкету — администратор проверит её, и вам откроется бронирование
                            кабинетов. Карточка появится в каталоге специалистов, где вас найдут клиенты.
                        </p>
                        <Panel inShell={inShell}>
                            <SectionTitle>Как это работает</SectionTitle>
                            <Steps steps={[
                                { label: 'Заполните анкету', sub: 'Имя, диплом, формат работы и стоимость', state: 'active' },
                                { label: 'Проверка', sub: REVIEW_TIME, state: 'todo' },
                                { label: 'Доступ к бронированию', sub: 'Откроется сразу после одобрения', state: 'todo' },
                            ]} />
                        </Panel>
                    </>
                ) : (
                    <EditingNote status={status} reason={applicationRejectReason(profile)} />
                )}
                <ApplicationForm
                    inShell={inShell}
                    form={form}
                    setField={setField}
                    priceText={priceText}
                    setPriceText={(v) => {
                        setPriceText(v);
                        setErrors(e => (e.basePriceGel ? { ...e, basePriceGel: undefined } : e));
                    }}
                    specInput={specInput}
                    setSpecInput={setSpecInput}
                    addSpec={addSpec}
                    removeSpec={removeSpec}
                    toggleFormat={toggleFormat}
                    addDocument={addDocument}
                    removeDocument={removeDocument}
                    errors={errors}
                    submitError={submitError}
                    submitting={submitting}
                    isResubmit={status !== 'none'}
                    onSubmit={handleSubmit}
                    onCancel={status !== 'none' ? cancelEditing : undefined}
                />
            </>
        );
    } else {
        body = (
            <StatusScreen
                inShell={inShell}
                status={status}
                canBook={canBook}
                reason={applicationRejectReason(profile)}
                headingRef={statusHeadingRef}
                homePath={homePath}
                bookingPath={bookingPath}
                crmProfilePath={crmProfilePath}
                onEdit={startEditing}
            />
        );
    }

    if (inShell) {
        return (
            <div style={{ fontFamily: 'var(--font-sans)', color: COLOR.ink }}>
                <MobilePageHeader title="Анкета специалиста" fallbackTo="/m/me" />
                <div style={{ padding: `${SPACE[4]}px ${SPACE[4]}px ${SPACE[6]}px`, display: 'flex', flexDirection: 'column', gap: SPACE[5] }}>
                    {body}
                </div>
            </div>
        );
    }

    const desktopTitle = showForm ? (status === 'none' ? 'Стать специалистом' : 'Моя анкета') : 'Анкета специалиста';
    return (
        <div style={{ minHeight: '100vh', background: COLOR.paper, color: COLOR.ink, fontFamily: 'var(--font-sans)' }}>
            <PublicHeader />
            <div style={{ maxWidth: 720, margin: '0 auto', padding: `${SPACE[6]}px ${SPACE[5]}px 96px` }}>
                <PageHeader back backLabel="Назад" backTo={homePath} title={desktopTitle} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE[5] }}>
                    {body}
                </div>
            </div>
        </div>
    );
}


// ── Оформление ───────────────────────────────────────────────────────────

const leadStyle: CSSProperties = {
    margin: 0,
    fontSize: TEXT.body,
    lineHeight: 1.5,
    color: COLOR.ink80,
};

const smallStyle: CSSProperties = {
    margin: 0,
    fontSize: TEXT.small,
    lineHeight: 1.5,
    color: COLOR.ink60,
};

/** Рамка блока: на телефоне скругление 16, на компьютере — прямые углы Grid House. */
function Panel({ inShell, children, tone }: { inShell: boolean; children: ReactNode; tone?: 'danger' }) {
    return (
        <section style={{
            border: `1px solid ${tone === 'danger' ? `${STATUS.danger.fg}40` : COLOR.ink20}`,
            background: tone === 'danger' ? STATUS.danger.bg : COLOR.card,
            borderRadius: inShell ? RADIUS.sheet : RADIUS.grid,
            padding: SPACE[4],
            display: 'flex',
            flexDirection: 'column',
            gap: SPACE[3],
        }}>
            {children}
        </section>
    );
}

function SectionTitle({ children }: { children: ReactNode }) {
    return (
        <h2 style={{ margin: 0, fontSize: TEXT.body, lineHeight: 1.3, fontWeight: 600, color: COLOR.ink }}>
            {children}
        </h2>
    );
}

function LoadingBlock() {
    return (
        <div role="status" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: SPACE[3] }}>
            <span className="sr-only">Загружаем анкету…</span>
            <Skeleton height={20} width="60%" />
            <Skeleton height={16} width="90%" />
            <Skeleton height={120} />
            <Skeleton height={44} />
            <Skeleton height={44} />
        </div>
    );
}

// ── Шаги «Заполнили → Проверка → Доступ к бронированию» ─────────────────

type StepState = 'done' | 'active' | 'waiting' | 'problem' | 'todo';
type Step = { label: string; sub?: string; state: StepState };

const STEP_SR: Record<StepState, string> = {
    done: 'готово',
    active: 'сейчас',
    waiting: 'идёт',
    problem: 'нужны правки',
    todo: 'впереди',
};

function StepMarker({ state, n }: { state: StepState; n: number }) {
    const base: CSSProperties = {
        width: 28, height: 28, borderRadius: '50%', flex: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: TEXT.caption, fontWeight: 600,
    };
    if (state === 'done') {
        return <span aria-hidden="true" style={{ ...base, background: STATUS.ok.bg, color: STATUS.ok.fg }}><Check size={16} strokeWidth={2.5} /></span>;
    }
    if (state === 'waiting') {
        return <span aria-hidden="true" style={{ ...base, background: STATUS.pending.bg, color: STATUS.pending.fg }}><Clock size={16} /></span>;
    }
    if (state === 'problem') {
        return <span aria-hidden="true" style={{ ...base, background: STATUS.danger.bg, color: STATUS.danger.fg }}><X size={16} strokeWidth={2.5} /></span>;
    }
    if (state === 'active') {
        return <span aria-hidden="true" style={{ ...base, background: COLOR.ink, color: COLOR.onInk }}>{n}</span>;
    }
    return <span aria-hidden="true" style={{ ...base, border: `1px solid ${COLOR.ink20}`, color: COLOR.ink60 }}>{n}</span>;
}

function Steps({ steps }: { steps: Step[] }) {
    return (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {steps.map((s, i) => {
                const last = i === steps.length - 1;
                const quiet = s.state === 'todo';
                return (
                    <li key={s.label} style={{ display: 'flex', gap: SPACE[3], alignItems: 'stretch' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <StepMarker state={s.state} n={i + 1} />
                            {!last && <span aria-hidden="true" style={{ flex: 1, width: 1, minHeight: 12, background: COLOR.ink20, margin: '4px 0' }} />}
                        </div>
                        <div style={{ paddingBottom: last ? 0 : SPACE[4], minWidth: 0 }}>
                            <div style={{ fontSize: TEXT.body, lineHeight: '28px', fontWeight: quiet ? 500 : 600, color: quiet ? COLOR.ink80 : COLOR.ink }}>
                                {s.label}
                                <span className="sr-only"> — {STEP_SR[s.state]}</span>
                            </div>
                            {s.sub && <div style={{ ...smallStyle, marginTop: 2 }}>{s.sub}</div>}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

// ── Экран статуса: на проверке / отклонена / одобрена ────────────────────

function StatusScreen({
    inShell, status, canBook, reason, headingRef, homePath, bookingPath, crmProfilePath, onEdit,
}: {
    inShell: boolean;
    status: SpecialistApplicationStatus;
    canBook: boolean;
    reason: string | null;
    headingRef: React.RefObject<HTMLHeadingElement | null>;
    homePath: string;
    bookingPath: string;
    crmProfilePath: string;
    onEdit: () => void;
}) {
    const block = inShell ? ' ui-btn--block' : '';
    const primaryLink = (to: string, label: string) => (
        <Link to={to} className={`ui-btn ui-btn--primary${block}`}>{label}</Link>
    );
    const secondaryLink = (to: string, label: string) => (
        <Link to={to} className={`ui-btn ui-btn--secondary${block}`}>{label}</Link>
    );
    const adminLink = (variant: 'primary' | 'secondary' | 'quiet') => (
        <a href={ADMIN_TG_URL} target="_blank" rel="noopener noreferrer" className={`ui-btn ui-btn--${variant}${block}`}>
            Написать администратору
        </a>
    );

    let title: string;
    let text: ReactNode;
    let steps: Step[];
    let actions: ReactNode;

    if (status === 'approved') {
        title = 'Анкета одобрена';
        steps = [
            { label: 'Заполнили анкету', state: 'done' },
            { label: 'Проверка', sub: 'Анкета одобрена', state: 'done' },
            canBook
                ? { label: 'Доступ к бронированию', sub: 'Бронирование кабинетов открыто', state: 'done' }
                : { label: 'Доступ к бронированию', sub: 'Открываем доступ', state: 'waiting' },
        ];
        if (canBook) {
            text = (
                <p style={leadStyle}>
                    Можно бронировать кабинеты. Ваша карточка — в каталоге специалистов; поменять её можно в профиле CRM.
                </p>
            );
            actions = <>{primaryLink(bookingPath, 'Забронировать кабинет')}{secondaryLink(crmProfilePath, 'Открыть профиль')}</>;
        } else {
            text = (
                <p style={leadStyle}>
                    Открываем доступ к бронированию — обычно это происходит сразу. Если через несколько минут
                    бронирование не появилось, напишите администратору.
                </p>
            );
            actions = <>{adminLink('primary')}{secondaryLink(homePath, 'В личный кабинет')}</>;
        }
    } else if (status === 'rejected') {
        title = 'Анкета не прошла проверку';
        steps = [
            { label: 'Заполнили анкету', state: 'done' },
            { label: 'Проверка', sub: 'Нужны правки', state: 'problem' },
            { label: 'Доступ к бронированию', sub: 'Откроется после одобрения', state: 'todo' },
        ];
        text = (
            <>
                <RejectReason reason={reason} />
                <p style={leadStyle}>
                    Исправьте анкету и отправьте её снова — {REVIEW_TIME.toLowerCase()}.
                </p>
            </>
        );
        actions = (
            <>
                <Button variant="primary" block={inShell} onClick={onEdit}>Исправить анкету</Button>
                {adminLink('secondary')}
            </>
        );
    } else {
        title = 'Анкета у администратора';
        steps = [
            { label: 'Заполнили анкету', state: 'done' },
            { label: 'Проверка', sub: REVIEW_TIME, state: 'waiting' },
            { label: 'Доступ к бронированию', sub: 'Откроется сразу после одобрения', state: 'todo' },
        ];
        text = (
            <p style={leadStyle}>
                {REVIEW_TIME}. Когда одобрим, вам откроется бронирование кабинетов, а карточка появится
                в каталоге специалистов.
            </p>
        );
        actions = (
            <>
                {primaryLink(homePath, 'В личный кабинет')}
                <Button variant="secondary" block={inShell} onClick={onEdit}>Изменить анкету</Button>
            </>
        );
    }

    return (
        <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE[3] }}>
                <h2
                    ref={headingRef}
                    tabIndex={-1}
                    style={{ margin: 0, fontSize: TEXT.title, lineHeight: 1.25, fontWeight: 600, color: COLOR.ink, outline: 'none' }}
                >
                    {title}
                </h2>
                {text}
            </div>
            <Panel inShell={inShell}>
                <Steps steps={steps} />
            </Panel>
            <div style={{
                display: 'flex',
                flexDirection: inShell ? 'column' : 'row',
                flexWrap: 'wrap',
                gap: SPACE[2],
            }}>
                {actions}
            </div>
            {status === 'pending' && (
                <p style={smallStyle}>
                    После правок анкета снова уйдёт на проверку. Вопросы — администратору
                    в <a href={ADMIN_TG_URL} target="_blank" rel="noopener noreferrer" style={{ color: COLOR.ink, textDecoration: 'underline' }}>Telegram</a>.
                </p>
            )}
        </>
    );
}

function RejectReason({ reason }: { reason: string | null }) {
    return (
        <div style={{
            background: STATUS.danger.bg,
            color: STATUS.danger.fg,
            border: `1px solid ${STATUS.danger.fg}40`,
            borderRadius: RADIUS.control,
            padding: `${SPACE[3]}px ${SPACE[4]}px`,
            fontSize: TEXT.small,
            lineHeight: 1.5,
        }}>
            {reason ? (
                <>
                    <div style={{ fontWeight: 600 }}>Комментарий администратора</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{reason}</div>
                </>
            ) : (
                <>Причину подскажет администратор — напишите ему в Telegram, он объяснит, что поправить.</>
            )}
        </div>
    );
}

/** Над формой при правке уже поданной анкеты: что будет после отправки. */
function EditingNote({ status, reason }: { status: SpecialistApplicationStatus; reason: string | null }) {
    if (status === 'rejected') {
        return (
            <>
                <RejectReason reason={reason} />
                <p style={leadStyle}>Исправьте анкету и отправьте её снова — {REVIEW_TIME.toLowerCase()}.</p>
            </>
        );
    }
    return (
        <p style={leadStyle}>
            Анкета сейчас на проверке. После правок она снова уйдёт администратору — {REVIEW_TIME.toLowerCase()}.
        </p>
    );
}

// ── Форма ────────────────────────────────────────────────────────────────

/** Группа без одного поля ввода (кнопки загрузки, чипы): подпись связана
 *  с группой через aria-labelledby, ошибка — под группой, как у Field. */
function FieldGroup({ id, label, hint, error, optional, children }: {
    id: string;
    label: ReactNode;
    hint?: ReactNode;
    error?: string;
    optional?: boolean;
    children: ReactNode;
}) {
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
    return (
        <div className="ui-field" role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy}>
            <div id={`${id}-label`} className="ui-field__label">
                {label}
                {optional && <span className="ui-field__optional"> · необязательно</span>}
            </div>
            {hint && <div id={`${id}-hint`} className="ui-field__hint" style={{ marginTop: 0 }}>{hint}</div>}
            {children}
            {error && (
                <div id={`${id}-error`} className="ui-field__error" aria-live="polite">
                    <AlertCircle size={16} aria-hidden="true" />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
}

function ApplicationForm({
    inShell, form, setField, priceText, setPriceText, specInput, setSpecInput, addSpec, removeSpec,
    toggleFormat, addDocument, removeDocument, errors, submitError, submitting, isResubmit, onSubmit, onCancel,
}: {
    inShell: boolean;
    form: SpecialistApplicationPayload;
    setField: <K extends keyof SpecialistApplicationPayload>(key: K, value: SpecialistApplicationPayload[K]) => void;
    priceText: string;
    setPriceText: (v: string) => void;
    specInput: string;
    setSpecInput: (v: string) => void;
    addSpec: () => void;
    removeSpec: (s: string) => void;
    toggleFormat: (id: string) => void;
    addDocument: (url: string) => void;
    removeDocument: (url: string) => void;
    errors: FormErrors;
    submitError: string | null;
    submitting: boolean;
    isResubmit: boolean;
    onSubmit: (e: React.FormEvent) => void;
    onCancel?: () => void;
}) {
    // На телефоне — одна колонка; на компьютере пары полей встают рядом.
    const pair: CSSProperties = {
        display: 'grid',
        gridTemplateColumns: inShell ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: SPACE[4],
    };
    const errorCount = ERROR_ORDER.filter(k => errors[k]).length;

    return (
        // noValidate: браузерные всплывашки «Заполните это поле» не нужны —
        // ошибки показываем сами, под полем, и ведём к первой.
        <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: SPACE[6] }}>
            <FormSection title="О вас">
                <div style={pair}>
                    <Field label="Имя" error={errors.firstName} id={FIELD_ID.firstName} required>
                        <Input
                            kind="name"
                            autoComplete="given-name"
                            value={form.firstName}
                            onChange={e => setField('firstName', e.target.value)}
                            maxLength={100}
                        />
                    </Field>
                    <Field label="Фамилия" error={errors.lastName} id={FIELD_ID.lastName} required>
                        <Input
                            kind="name"
                            autoComplete="family-name"
                            value={form.lastName}
                            onChange={e => setField('lastName', e.target.value)}
                            maxLength={100}
                        />
                    </Field>
                </div>

                {/* Документы — ОБЯЗАТЕЛЬНО (дипломы/сертификаты). Стоят выше
                    необязательного фото: раньше главной выглядела кнопка фото. */}
                <FieldGroup
                    id={FIELD_ID.documents}
                    label="Диплом или сертификат"
                    hint="Подтверждение образования: pdf, jpg или png, до 20 МБ. Можно несколько файлов."
                    error={errors.documents}
                >
                    {form.documents.length > 0 && (
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: SPACE[2] }}>
                            {form.documents.map((url, i) => (
                                <li key={url} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE[2],
                                    border: `1px solid ${COLOR.ink20}`, borderRadius: RADIUS.control,
                                    padding: `0 0 0 ${SPACE[3]}px`, fontSize: TEXT.small,
                                }}>
                                    <a href={url} target="_blank" rel="noreferrer" style={{ color: COLOR.ink, textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        <FileText size={16} aria-hidden="true" />
                                        Документ {i + 1}
                                    </a>
                                    <Button variant="quiet" onClick={() => removeDocument(url)} aria-label={`Убрать документ ${i + 1}`}>
                                        Убрать
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <DocumentUpload
                        buttonId={FIELD_ID.documents}
                        hasAny={form.documents.length > 0}
                        invalid={!!errors.documents}
                        describedBy={errors.documents ? `${FIELD_ID.documents}-error` : `${FIELD_ID.documents}-hint`}
                        block={inShell}
                        onUploaded={addDocument}
                    />
                </FieldGroup>

                <FieldGroup
                    id="bs-photo"
                    label="Фото профиля"
                    optional
                    hint="jpg или png. Можно добавить позже."
                >
                    <ProfilePhotoUpload
                        current={form.photoUrl || ''}
                        onUploaded={(url) => setField('photoUrl', url)}
                    />
                </FieldGroup>
            </FormSection>

            <FormSection title="Карточка в каталоге">
                <Field label="Слоган" optional hint="Одна строка под именем в карточке.">
                    <Input
                        value={form.tagline || ''}
                        onChange={e => setField('tagline', e.target.value)}
                        maxLength={150}
                        placeholder="Гештальт-терапевт. Работаю с тревогой и выгоранием."
                    />
                </Field>

                <Field label="О себе" optional hint="Образование, подходы, опыт, с чем работаете.">
                    <TextArea
                        value={form.bio || ''}
                        onChange={e => setField('bio', e.target.value)}
                        maxLength={5000}
                        rows={6}
                        style={{ minHeight: 140, padding: `${SPACE[2]}px ${SPACE[3]}px` }}
                    />
                </Field>

                <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE[2] }}>
                    <Field label="Специализации" optional hint="Методы и темы — по одной: «Гештальт-терапия», «КПТ», «Работа с тревогой».">
                        <div style={{ display: 'flex', gap: SPACE[2] }}>
                            <Input
                                value={specInput}
                                onChange={e => setSpecInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpec(); } }}
                                enterKeyHint="done"
                                placeholder="Например, КПТ"
                            />
                            <Button variant="secondary" onClick={addSpec} disabled={!specInput.trim()}>Добавить</Button>
                        </div>
                    </Field>
                    {form.specializations.length > 0 && (
                        <ul aria-label="Добавленные специализации" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: SPACE[2] }}>
                            {form.specializations.map(s => (
                                <li key={s} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 2,
                                    padding: `0 0 0 ${SPACE[3]}px`, border: `1px solid ${COLOR.ink20}`,
                                    borderRadius: RADIUS.control, background: COLOR.sunken, fontSize: TEXT.small, color: COLOR.ink,
                                }}>
                                    {s}
                                    <Button variant="quiet" icon={<X size={16} aria-hidden="true" />} onClick={() => removeSpec(s)} aria-label={`Убрать «${s}»`} />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <FieldGroup id={FIELD_ID.formats} label="Формат работы" hint="Можно выбрать несколько." error={errors.formats}>
                    <div className="ui-chip-row">
                        {FORMATS.map((f, i) => (
                            <Chip
                                key={f.id}
                                id={i === 0 ? FIELD_ID.formats : undefined}
                                selected={form.formats.includes(f.id)}
                                onClick={() => toggleFormat(f.id)}
                            >
                                {f.label}
                            </Chip>
                        ))}
                    </div>
                </FieldGroup>

                <div style={pair}>
                    <Field label="Направление">
                        <Select value={form.category || ''} onChange={e => setField('category', e.target.value)}>
                            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </Select>
                    </Field>
                    <Field
                        label="Стоимость консультации"
                        hint="За час, в лари. Клиенты увидят её в вашей карточке."
                        error={errors.basePriceGel}
                        id={FIELD_ID.basePriceGel}
                        required
                    >
                        <Input
                            kind="integer"
                            suffix="₾"
                            value={priceText}
                            onChange={e => setPriceText(e.target.value.replace(/\D/g, '').slice(0, 5))}
                            placeholder="Например, 80"
                        />
                    </Field>
                </div>
            </FormSection>

            <FormSection title="Контакты" note="Необязательно. Покажем в карточке, чтобы клиенты могли написать вам.">
                <Field label="Instagram" optional>
                    <Input
                        value={form.instagram || ''}
                        onChange={e => setField('instagram', e.target.value)}
                        maxLength={200}
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="@username или ссылка"
                    />
                </Field>
                <Field label="Telegram" optional>
                    <Input
                        value={form.telegram || ''}
                        onChange={e => setField('telegram', e.target.value)}
                        maxLength={200}
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="@username или ссылка"
                    />
                </Field>
                <Field label="Сайт" optional>
                    <Input
                        type="url"
                        inputMode="url"
                        value={form.website || ''}
                        onChange={e => setField('website', e.target.value)}
                        maxLength={300}
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="https://…"
                    />
                </Field>
            </FormSection>

            <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE[3] }}>
                {errorCount > 0 && (
                    <div className="ui-field__error" role="alert">
                        <AlertCircle size={16} aria-hidden="true" />
                        <span>
                            {errorCount === 1 ? 'Заполните отмеченное поле выше' : `Заполните отмеченные поля выше — их ${errorCount}`}
                        </span>
                    </div>
                )}
                {submitError && <ErrorBar message={submitError} />}
                <div style={{ display: 'flex', flexDirection: inShell ? 'column' : 'row', flexWrap: 'wrap', gap: SPACE[2] }}>
                    <Button type="submit" variant="primary" block={inShell} loading={submitting}>
                        {submitting ? 'Отправляем…' : isResubmit ? 'Отправить снова' : 'Отправить анкету'}
                    </Button>
                    {onCancel && (
                        <Button variant="secondary" block={inShell} onClick={onCancel} disabled={submitting}>
                            Не менять
                        </Button>
                    )}
                </div>
                <p style={smallStyle}>{REVIEW_TIME}. Ответ увидите на этой странице.</p>
            </div>
        </form>
    );
}

function FormSection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
    return (
        <section style={{ display: 'flex', flexDirection: 'column', gap: SPACE[4] }}>
            <div style={{ borderBottom: `1px solid ${COLOR.ink10}`, paddingBottom: SPACE[2] }}>
                <SectionTitle>{title}</SectionTitle>
                {note && <p style={{ ...smallStyle, marginTop: 4 }}>{note}</p>}
            </div>
            {children}
        </section>
    );
}


/** Загрузка документа (диплом/сертификат). Через /upload/task-file —
 *  принимает pdf + картинки, до 20 МБ. Каждый вызов добавляет один файл. */
function DocumentUpload({ onUploaded, buttonId, hasAny, invalid, describedBy, block }: {
    onUploaded: (url: string) => void;
    buttonId: string;
    hasAny: boolean;
    invalid: boolean;
    describedBy?: string;
    block: boolean;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [busy, setBusy] = useState(false);
    const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
            const data = new FormData();
            data.append('file', file);
            const res = await api.post<{ url: string }>('/upload/task-file', data, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const baseUrl = (API_URL || '').replace('/api/v1', '');
            onUploaded(`${baseUrl}${res.data.url}`);
            toast.success('Документ загружен');
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось загрузить документ');
        } finally {
            setBusy(false);
            e.target.value = '';
        }
    };
    return (
        <div>
            <input ref={inputRef} type="file" accept=".pdf,image/*" onChange={handlePick} style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />
            <Button
                id={buttonId}
                variant="secondary"
                block={block}
                loading={busy}
                icon={<Upload size={18} aria-hidden="true" />}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onClick={() => inputRef.current?.click()}
                style={invalid ? { borderColor: STATUS.danger.fg } : undefined}
            >
                {busy ? 'Загружаем…' : hasAny ? 'Добавить ещё документ' : 'Загрузить диплом или сертификат'}
            </Button>
        </div>
    );
}


/** Public application form's photo upload. Same /upload endpoint as the
 *  CRM profile / admin specialists modal — 2 MB cap, image-only.
 *  Shows a 56×56 preview tile next to the button if a photo is already set. */
function ProfilePhotoUpload({ current, onUploaded }: { current: string; onUploaded: (url: string) => void }) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [busy, setBusy] = useState(false);
    const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
            const upload = await compressImage(file);
            if (upload.size > 2 * 1024 * 1024) {
                toast.error('Фото слишком большое даже после сжатия — попробуйте другое.');
                return;
            }
            const data = new FormData();
            data.append('file', upload);
            const res = await api.post<{ url: string }>('/upload/', data, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const baseUrl = (API_URL || '').replace('/api/v1', '');
            onUploaded(`${baseUrl}${res.data.url}`);
            toast.success('Фото загружено');
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось загрузить фото');
        } finally {
            setBusy(false);
            e.target.value = '';
        }
    };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE[3] }}>
            {current && (
                <img src={current} alt="Ваше фото" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: RADIUS.control, border: `1px solid ${COLOR.ink10}` }} />
            )}
            <input ref={inputRef} type="file" accept="image/*" onChange={handlePick} style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />
            <Button
                variant="secondary"
                loading={busy}
                icon={<Upload size={18} aria-hidden="true" />}
                onClick={() => inputRef.current?.click()}
            >
                {busy ? 'Загружаем…' : (current ? 'Заменить фото' : 'Загрузить фото')}
            </Button>
        </div>
    );
}
