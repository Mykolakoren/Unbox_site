/**
 * Grid House variant of the landing page.
 *
 * Rollback plan:
 *   1. Delete this file.
 *   2. Remove the `if (useDesignFlag()) return <GridHouseLanding ... />` block
 *      at the top of `ExplorePage.tsx`.
 *   3. Done — default liquid-glass landing is byte-for-byte unchanged.
 *
 * Reference: Vignelli NYC Subway (1972), Bierut Yale Architecture posters.
 * One move: typography and grid carry everything. Images are evidence.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useLocations } from '../../hooks/useLocations';
import { useUserStore } from '../../store/userStore';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import type { Specialist } from '../Specialists/SpecialistCard';
import type { Location } from '../../types/index';

type VisitorMode = 'client' | 'specialist' | null;

interface Props {
    visitorMode: VisitorMode;
    onModeSelect: (mode: 'client' | 'specialist') => void;
    onModeReset: () => void;
}

// ──────────────────────────────────────────────────────────────────────────
// Shared tokens
// ──────────────────────────────────────────────────────────────────────────
const PAGE_BG: React.CSSProperties = {
    background: GH.paper,
    color: GH.ink,
    fontFamily: GH_SANS,
    minHeight: '100vh',
    WebkitFontSmoothing: 'antialiased',
    overflowX: 'hidden',
};
const HAIRLINE = `1px solid ${GH.ink10}`;
const MONO_LABEL: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 10,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    // Teal label experiment — swap back to GH.ink60 to revert.
    color: GH.label,
};
const MONO_LABEL_INK: React.CSSProperties = { ...MONO_LABEL, color: GH.ink };

// ──────────────────────────────────────────────────────────────────────────
// Hook: responsive width
// ──────────────────────────────────────────────────────────────────────────
function useNarrow(breakpoint = 960) {
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < breakpoint);
    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < breakpoint);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, [breakpoint]);
    return narrow;
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry
// ──────────────────────────────────────────────────────────────────────────
export function GridHouseLanding({ visitorMode, onModeSelect, onModeReset }: Props) {
    if (visitorMode === null) {
        return <WelcomeGate onSelect={onModeSelect} />;
    }
    if (visitorMode === 'specialist') {
        return <SpecialistRoute onReset={onModeReset} />;
    }
    return <ClientLanding onReset={onModeReset} />;
}

// ──────────────────────────────────────────────────────────────────────────
// WELCOME GATE — replaces the fullscreen modal with a typographic split
// ──────────────────────────────────────────────────────────────────────────
function WelcomeGate({ onSelect }: { onSelect: (m: 'client' | 'specialist') => void }) {
    const narrow = useNarrow(800);

    return (
        <div style={{ ...PAGE_BG, display: 'flex', flexDirection: 'column' }}>
            {/* Masthead — minimal */}
            <div
                style={{
                    borderBottom: HAIRLINE,
                    padding: '20px clamp(16px, 4vw, 32px)',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 16,
                    justifyContent: 'space-between',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>Unbox</div>
                    <div style={MONO_LABEL}>Батуми · Пространство для практики</div>
                </div>
            </div>

            {/* Two columns */}
            <div
                style={{
                    flex: 1,
                    display: 'grid',
                    gridTemplateColumns: narrow ? '1fr' : '1fr 1fr',
                }}
            >
                <GateColumn
                    num="01"
                    title="Я клиент"
                    tag="Ищу специалиста"
                    body="Психологи, терапевты, коучи и педагоги. Подобрать специалиста, посмотреть расписание, записаться на сессию очно в Батуми или онлайн."
                    cta="Войти как клиент"
                    onClick={() => onSelect('client')}
                    borderRight={!narrow}
                    borderBottom={narrow}
                />
                <GateColumn
                    num="02"
                    title="Я специалист"
                    tag="Принимаю клиентов"
                    body="Аренда кабинетов, приём клиентов, CRM для ведения практики. Для специалистов, которые принимают в пространствах Unbox."
                    cta="Войти как специалист"
                    onClick={() => onSelect('specialist')}
                />
            </div>

            {/* Footer strip */}
            <div
                style={{
                    borderTop: HAIRLINE,
                    padding: '16px clamp(16px, 4vw, 32px)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    ...MONO_LABEL,
                }}
            >
                <span>Выберите режим, чтобы продолжить</span>
                <span>unbox.com.ge</span>
            </div>
        </div>
    );
}

function GateColumn({
    num,
    title,
    tag,
    body,
    cta,
    onClick,
    borderRight,
    borderBottom,
}: {
    num: string;
    title: string;
    tag: string;
    body: string;
    cta: string;
    onClick: () => void;
    borderRight?: boolean;
    borderBottom?: boolean;
}) {
    const [hover, setHover] = useState(false);
    return (
        <button
            type="button"
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: 'clamp(40px, 6vw, 72px) clamp(16px, 5vw, 56px)',
                borderRight: borderRight ? HAIRLINE : undefined,
                borderBottom: borderBottom ? HAIRLINE : undefined,
                background: hover ? GH.ink : GH.paper,
                color: hover ? GH.paper : GH.ink,
                cursor: 'pointer',
                textAlign: 'left',
                minHeight: 440,
                fontFamily: GH_SANS,
                transition: 'background 0.15s ease, color 0.15s ease',
                border: 'none',
                outline: 'none',
                width: '100%',
            }}
        >
            <div>
                {/* Excel #42 — admins wanted "small caption UNDER the big title"
                    ("Я клиент" + "Ищу специалиста" below). Previously the tag
                    sat above the title as a header; we now put it right below
                    the big type so it reads like an actual subtitle. */}
                <div
                    style={{
                        fontFamily: GH_MONO,
                        fontSize: 11,
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                        opacity: 0.5,
                        marginBottom: 24,
                    }}
                >
                    {num}
                </div>
                <div
                    style={{
                        fontSize: 'clamp(56px, 6.5vw, 92px)',
                        fontWeight: 800,
                        lineHeight: 0.95,
                        letterSpacing: '-0.02em',
                        marginBottom: 12,
                    }}
                >
                    {title}
                </div>
                <div
                    style={{
                        fontFamily: GH_MONO,
                        fontSize: 12,
                        letterSpacing: '0.16em',
                        textTransform: 'uppercase',
                        opacity: 0.72,
                        marginBottom: 24,
                    }}
                >
                    {tag}
                </div>
                <div style={{ fontSize: 17, lineHeight: 1.5, maxWidth: 420, opacity: 0.78 }}>{body}</div>
            </div>
            <div
                style={{
                    fontFamily: GH_MONO,
                    fontSize: 11,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    marginTop: 48,
                    borderTop: `1px solid ${hover ? 'rgba(250,250,247,0.25)' : GH.ink10}`,
                    paddingTop: 20,
                }}
            >
                → {cta}
            </div>
        </button>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// MASTHEAD — shared across client and specialist routes
// ──────────────────────────────────────────────────────────────────────────
function Masthead({
    mode,
    onReset,
}: {
    mode: 'client' | 'specialist';
    onReset: () => void;
}) {
    const { currentUser, logout } = useUserStore();
    const navigate = useNavigate();
    const isAdmin = Boolean(currentUser && ['admin', 'senior_admin', 'owner'].includes(currentUser.role ?? ''));
    const narrow = useNarrow(760);

    const modeLabel = mode === 'client' ? 'Клиент' : 'Специалист';

    return (
        <header
            style={{
                borderBottom: HAIRLINE,
                background: GH.paper,
                position: 'sticky',
                top: 0,
                zIndex: 40,
            }}
        >
            <div
                style={{
                    maxWidth: 1280,
                    margin: '0 auto',
                    padding: '18px clamp(16px, 4vw, 32px)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 20,
                    justifyContent: 'space-between',
                }}
            >
                {/* Left: wordmark + mode switch */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, flexWrap: 'wrap' }}>
                    <Link to="/" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', color: GH.ink, textDecoration: 'none' }}>
                        Unbox
                    </Link>
                    {/* Excel #42 — mode-switch indicator is now shown on every
                        width (was hidden on narrow) so visitors on phones can
                        actually flip between "Клиент" and "Специалист"
                        instead of getting stuck in whichever they picked once. */}
                    <button
                        type="button"
                        onClick={onReset}
                        title="Сменить режим"
                        style={{
                            ...MONO_LABEL,
                            background: 'transparent',
                            border: `1px solid ${GH.ink10}`,
                            padding: narrow ? '4px 8px' : '3px 10px',
                            cursor: 'pointer',
                            color: GH.ink60,
                            fontSize: narrow ? 9 : 10,
                        }}
                    >
                        Режим: {modeLabel.toLowerCase()} ↔
                    </button>
                </div>

                {/* Right: nav */}
                <nav style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    <NavLink to="/specialists" label="Специалисты" />
                    <NavDivider />
                    <NavLink to="/#cabinets" label="Кабинеты" />
                    <NavDivider />
                    <NavLink to="/subscriptions" label="Тарифы" hideOnNarrow={narrow} />
                    {currentUser && (
                        <>
                            <NavDivider hideOnNarrow={narrow} />
                            <NavLink to="/dashboard/bookings" label="Бронирования" hideOnNarrow={narrow} />
                        </>
                    )}
                    {isAdmin && (
                        <>
                            <NavDivider hideOnNarrow={narrow} />
                            <NavLink to="/admin" label="Админ" hideOnNarrow={narrow} />
                        </>
                    )}
                    <NavDivider />
                    {currentUser ? (
                        <>
                            <NavLink to="/dashboard" label={currentUser.name ?? 'Кабинет'} />
                            <NavDivider />
                            <button
                                type="button"
                                onClick={() => {
                                    logout();
                                    navigate('/');
                                }}
                                style={{
                                    ...MONO_LABEL,
                                    color: GH.danger,
                                    background: 'transparent',
                                    border: 'none',
                                    padding: '4px 0',
                                    cursor: 'pointer',
                                }}
                            >
                                Выйти
                            </button>
                        </>
                    ) : (
                        <NavLink to="/login" label="Войти" accent />
                    )}
                </nav>
            </div>
        </header>
    );
}

function NavLink({
    to,
    label,
    accent,
    hideOnNarrow,
}: {
    to: string;
    label: string;
    accent?: boolean;
    hideOnNarrow?: boolean;
}) {
    if (hideOnNarrow) return null;
    const isHash = to.startsWith('#') || to.includes('#');
    const baseStyle: React.CSSProperties = {
        ...MONO_LABEL,
        color: accent ? GH.ink : GH.ink60,
        fontWeight: accent ? 700 : 400,
        padding: '4px 12px',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
    };
    if (isHash) {
        const handleClick = (e: React.MouseEvent) => {
            const hash = to.includes('#') ? '#' + to.split('#')[1] : to;
            const el = document.getElementById(hash.slice(1));
            if (el) {
                e.preventDefault();
                el.scrollIntoView({ behavior: 'smooth' });
            } else {
                // Section not on this page — reset visitor mode & force full navigation
                e.preventDefault();
                localStorage.setItem('unbox_visitor_mode', 'client');
                window.location.href = to;
            }
        };
        return (
            <a href={to} style={baseStyle} onClick={handleClick}>
                {label}
            </a>
        );
    }
    return (
        <Link to={to} style={baseStyle}>
            {label}
        </Link>
    );
}

function NavDivider({ hideOnNarrow }: { hideOnNarrow?: boolean }) {
    if (hideOnNarrow) return null;
    return <span aria-hidden style={{ color: GH.ink30, fontFamily: GH_MONO, fontSize: 10 }}>·</span>;
}

// ──────────────────────────────────────────────────────────────────────────
// CLIENT LANDING
// ──────────────────────────────────────────────────────────────────────────
const CATEGORIES = [
    { value: 'psychology', label: 'Психологи' },
    { value: 'psychiatry', label: 'Психиатры' },
    { value: 'narcology', label: 'Наркология' },
    { value: 'coaching', label: 'Коучи' },
    { value: 'education', label: 'Педагоги' },
] as const;

function ClientLanding({ onReset }: { onReset: () => void }) {
    const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
    const [specialists, setSpecialists] = useState<Specialist[]>([]);
    const [loading, setLoading] = useState(true);
    const { data: locations = [] } = useLocations();

    useEffect(() => {
        setLoading(true);
        const params = categoryFilter ? `?category=${categoryFilter}` : '';
        api
            .get(`/specialists${params}`)
            .then((r) => setSpecialists(r.data))
            .catch(() => setSpecialists([]))
            .finally(() => setLoading(false));
    }, [categoryFilter]);

    const totalSpecialists = specialists.length;

    return (
        <div style={PAGE_BG}>
            <Masthead mode="client" onReset={onReset} />
            <main>
                <Hero totalSpecialists={totalSpecialists} locations={locations} />
                <StatStrip totalSpecialists={totalSpecialists} totalLocations={locations.length} />
                <CategoryStrip active={categoryFilter} onChange={setCategoryFilter} />
                <SpecialistIndex specialists={specialists} loading={loading} categoryFilter={categoryFilter} />
                <CabinetsBlock locations={locations} />
                <ContactFooter />
            </main>
        </div>
    );
}

// ────── Hero ──────
function Hero({ totalSpecialists, locations }: { totalSpecialists: number; locations: Location[] }) {
    return (
        <section
            style={{
                maxWidth: 1280,
                margin: '0 auto',
                padding: 'clamp(56px, 9vw, 120px) clamp(16px, 4vw, 32px) clamp(40px, 6vw, 80px)',
                borderBottom: HAIRLINE,
            }}
        >
            <div style={{ ...MONO_LABEL, marginBottom: 32 }}>
                Терапия · Психиатрия · Коучинг · Педагогика
            </div>
            <h1
                style={{
                    fontSize: 'clamp(36px, 8vw, 124px)',
                    fontWeight: 800,
                    lineHeight: 0.92,
                    letterSpacing: '-0.025em',
                    margin: 0,
                    marginBottom: 36,
                    maxWidth: 1100,
                    overflowWrap: 'break-word',
                    wordBreak: 'break-word',
                }}
            >
                {totalSpecialists || 17} специалистов
                <br />
                в&nbsp;Батуми и&nbsp;онлайн.
            </h1>
            <p
                style={{
                    fontSize: 'clamp(17px, 1.3vw, 20px)',
                    lineHeight: 1.55,
                    color: GH.ink60,
                    maxWidth: 640,
                    margin: 0,
                    marginBottom: 44,
                }}
            >
                Психологи, терапевты, коучи и педагоги принимают в&nbsp;{locations.length || 2}&nbsp;кабинетах
                в&nbsp;центре города или онлайн из&nbsp;любой точки мира. Выбор специалиста, запись на&nbsp;сессию
                и&nbsp;личная история — всё в&nbsp;одном месте.
            </p>

            {/* CTA row */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <HeroCta to="/specialists" primary>
                    Смотреть специалистов →
                </HeroCta>
                <HeroCta to="#cabinets">Кабинеты Unbox →</HeroCta>
            </div>
        </section>
    );
}

function HeroCta({ to, primary, children }: { to: string; primary?: boolean; children: React.ReactNode }) {
    const [hover, setHover] = useState(false);
    const style: React.CSSProperties = {
        fontFamily: GH_MONO,
        fontSize: 12,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        textDecoration: 'none',
        padding: '18px 28px',
        border: `1px solid ${GH.ink}`,
        background: primary ? (hover ? GH.accent : GH.ink) : hover ? GH.ink : 'transparent',
        color: primary ? GH.paper : hover ? GH.paper : GH.ink,
        fontWeight: 600,
        transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
        borderColor: primary && hover ? GH.accent : GH.ink,
        cursor: 'pointer',
        display: 'inline-block',
    };
    const isHash = to.startsWith('#') || to.includes('#');
    if (isHash) {
        return (
            <a href={to} style={style} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
                {children}
            </a>
        );
    }
    return (
        <Link to={to} style={style} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
            {children}
        </Link>
    );
}

// ────── Stat strip ──────
function StatStrip({ totalSpecialists, totalLocations }: { totalSpecialists: number; totalLocations: number }) {
    const narrow = useNarrow(760);
    const cells = [
        { num: String(totalSpecialists || 17).padStart(2, '0'), label: 'Специалистов', sub: 'В активной практике' },
        { num: String(totalLocations || 2).padStart(2, '0'), label: 'Кабинета', sub: 'Unbox Uni · Unbox One' },
        { num: '05', label: 'Категорий', sub: 'Терапия · Психиатрия · Коучинг' },
        { num: '∞', label: 'Онлайн', sub: 'Из любой точки мира' },
    ];
    return (
        <section
            style={{
                maxWidth: 1280,
                margin: '0 auto',
                padding: '0 clamp(16px, 4vw, 32px)',
                borderBottom: HAIRLINE,
            }}
        >
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: narrow ? '1fr 1fr' : 'repeat(4, 1fr)',
                }}
            >
                {cells.map((c, i) => (
                    <div
                        key={c.label}
                        style={{
                            padding: '32px 24px 36px',
                            borderRight: !narrow && i < cells.length - 1 ? HAIRLINE : undefined,
                            borderRight_NARROW: undefined,
                            ...(narrow && i % 2 === 0 ? { borderRight: HAIRLINE } : {}),
                            ...(narrow && i < 2 ? { borderBottom: HAIRLINE } : {}),
                        } as React.CSSProperties}
                    >
                        <div style={{ ...MONO_LABEL, marginBottom: 12 }}>{c.label}</div>
                        <div
                            style={{
                                fontSize: 'clamp(44px, 5vw, 68px)',
                                fontWeight: 800,
                                lineHeight: 1,
                                letterSpacing: '-0.02em',
                                fontVariantNumeric: 'tabular-nums',
                                marginBottom: 12,
                            }}
                        >
                            {c.num}
                        </div>
                        <div style={{ fontSize: 13, color: GH.ink60, lineHeight: 1.4 }}>{c.sub}</div>
                    </div>
                ))}
            </div>
        </section>
    );
}

// ────── Category strip ──────
function CategoryStrip({
    active,
    onChange,
}: {
    active: string | null;
    onChange: (v: string | null) => void;
}) {
    const narrow = useNarrow(760);

    return (
        <section
            id="specialists"
            style={{
                maxWidth: 1280,
                margin: '0 auto',
                padding: '56px clamp(16px, 4vw, 32px) 0',
            }}
        >
            <div style={{ ...MONO_LABEL, marginBottom: 20 }}>Фильтр · Категория</div>
            <div
                style={{
                    border: HAIRLINE,
                    display: 'grid',
                    gridTemplateColumns: narrow ? '1fr 1fr' : `repeat(${CATEGORIES.length + 1}, 1fr)`,
                }}
            >
                <CategoryCell
                    num="00"
                    label="Все"
                    isActive={active === null}
                    onClick={() => onChange(null)}
                    isLast={false}
                    narrow={narrow}
                    index={0}
                    total={CATEGORIES.length + 1}
                />
                {CATEGORIES.map((c, i) => (
                    <CategoryCell
                        key={c.value}
                        num={String(i + 1).padStart(2, '0')}
                        label={c.label}
                        isActive={active === c.value}
                        onClick={() => onChange(c.value === active ? null : c.value)}
                        isLast={i === CATEGORIES.length - 1}
                        narrow={narrow}
                        index={i + 1}
                        total={CATEGORIES.length + 1}
                    />
                ))}
            </div>
        </section>
    );
}

function CategoryCell({
    num,
    label,
    isActive,
    onClick,
    narrow,
    index,
    total,
}: {
    num: string;
    label: string;
    isActive: boolean;
    onClick: () => void;
    isLast: boolean;
    narrow: boolean;
    index: number;
    total: number;
}) {
    const [hover, setHover] = useState(false);
    const rowsPerCol = 2;
    const rightBorder = narrow ? index % rowsPerCol === 0 : index < total - 1;
    const bottomBorder = narrow && Math.floor(index / rowsPerCol) < Math.ceil(total / rowsPerCol) - 1;

    return (
        <button
            type="button"
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                padding: '20px 18px',
                borderRight: rightBorder ? HAIRLINE : undefined,
                borderBottom: bottomBorder ? HAIRLINE : undefined,
                background: isActive ? GH.ink : hover ? GH.ink5 : 'transparent',
                color: isActive ? GH.paper : GH.ink,
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                transition: 'background 0.15s ease, color 0.15s ease',
                width: '100%',
                fontFamily: GH_SANS,
            }}
        >
            <div
                style={{
                    fontFamily: GH_MONO,
                    fontSize: 10,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    opacity: isActive ? 0.6 : 0.5,
                }}
            >
                {num}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.005em' }}>{label}</div>
        </button>
    );
}

// ────── Specialist index ──────
function SpecialistIndex({
    specialists,
    loading,
    categoryFilter,
}: {
    specialists: Specialist[];
    loading: boolean;
    categoryFilter: string | null;
}) {
    const narrow = useNarrow(760);

    return (
        <section style={{ maxWidth: 1280, margin: '0 auto', padding: '56px clamp(16px, 4vw, 32px) 0' }}>
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 24,
                    flexWrap: 'wrap',
                    gap: 16,
                }}
            >
                <div>
                    <div style={{ ...MONO_LABEL, marginBottom: 12 }}>Индекс · Специалисты Unbox</div>
                    <h2
                        style={{
                            fontSize: 'clamp(36px, 4.5vw, 64px)',
                            fontWeight: 800,
                            lineHeight: 0.95,
                            letterSpacing: '-0.02em',
                            margin: 0,
                        }}
                    >
                        {categoryFilter
                            ? CATEGORIES.find((c) => c.value === categoryFilter)?.label ?? 'Специалисты'
                            : 'Специалисты Unbox'}
                    </h2>
                </div>
                <div style={{ ...MONO_LABEL_INK, fontVariantNumeric: 'tabular-nums' }}>
                    Всего: {String(specialists.length).padStart(2, '0')}
                </div>
            </div>

            <div style={{ border: HAIRLINE, borderBottom: 'none' }}>
                {/* Header row */}
                {!narrow && (
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '64px 104px 1fr 180px 120px',
                            alignItems: 'center',
                            padding: '14px 20px',
                            borderBottom: HAIRLINE,
                            background: GH.ink5,
                            ...MONO_LABEL,
                        }}
                    >
                        <div>№</div>
                        <div>Фото</div>
                        <div>Имя · Специализация</div>
                        <div>Формат</div>
                        <div style={{ textAlign: 'right' }}>От, ₾</div>
                    </div>
                )}

                {loading && (
                    <div
                        style={{
                            padding: '48px 20px',
                            textAlign: 'center',
                            borderBottom: HAIRLINE,
                            color: GH.ink60,
                            ...MONO_LABEL,
                        }}
                    >
                        Загрузка специалистов…
                    </div>
                )}

                {!loading && specialists.length === 0 && (
                    <div
                        style={{
                            padding: '48px 20px',
                            textAlign: 'center',
                            borderBottom: HAIRLINE,
                            color: GH.ink60,
                            ...MONO_LABEL,
                        }}
                    >
                        Нет специалистов в этой категории
                    </div>
                )}

                {!loading &&
                    specialists.map((s, i) => (
                        <SpecialistRow key={s.id} specialist={s} num={i + 1} narrow={narrow} />
                    ))}
            </div>
        </section>
    );
}

function SpecialistRow({ specialist, num, narrow }: { specialist: Specialist; num: number; narrow: boolean }) {
    const [hover, setHover] = useState(false);
    const formats = specialist.formats ?? [];
    const hasOnline = formats.includes('ONLINE');
    const hasOffline = formats.includes('OFFLINE_ROOM') || formats.includes('OFFLINE_CAPSULE');
    const formatLabel = [hasOffline && 'Очно', hasOnline && 'Онлайн'].filter(Boolean).join(' · ') || '—';

    const rowStyle: React.CSSProperties = {
        display: 'grid',
        gridTemplateColumns: narrow ? '52px 72px 1fr 90px' : '64px 104px 1fr 180px 120px',
        alignItems: 'center',
        padding: narrow ? '16px 16px' : '18px 20px',
        borderBottom: HAIRLINE,
        background: hover ? GH.ink5 : 'transparent',
        textDecoration: 'none',
        color: GH.ink,
        transition: 'background 0.1s ease',
        fontFamily: GH_SANS,
    };

    return (
        <Link
            to={`/specialists/${specialist.id}`}
            style={rowStyle}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
        >
            {/* Number */}
            <div
                style={{
                    fontFamily: GH_MONO,
                    fontSize: 13,
                    color: GH.ink60,
                    fontVariantNumeric: 'tabular-nums',
                }}
            >
                {String(num).padStart(2, '0')}
            </div>

            {/* Photo in hairline frame */}
            <div
                style={{
                    width: narrow ? 60 : 88,
                    height: narrow ? 76 : 112,
                    border: HAIRLINE,
                    padding: 3,
                    background: GH.paper,
                }}
            >
                {specialist.photoUrl ? (
                    <img
                        src={specialist.photoUrl}
                        alt={`${specialist.firstName} ${specialist.lastName}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                ) : (
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            background: GH.cellDead,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontFamily: GH_MONO,
                            fontSize: 11,
                            color: GH.ink30,
                        }}
                    >
                        —
                    </div>
                )}
            </div>

            {/* Name + tagline */}
            <div style={{ paddingLeft: narrow ? 14 : 20, minWidth: 0 }}>
                <div
                    style={{
                        fontSize: narrow ? 17 : 22,
                        fontWeight: 700,
                        letterSpacing: '-0.01em',
                        lineHeight: 1.15,
                        marginBottom: 6,
                    }}
                >
                    {specialist.firstName} {specialist.lastName}
                </div>
                <div
                    style={{
                        fontSize: narrow ? 12 : 14,
                        color: GH.ink60,
                        lineHeight: 1.45,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                    }}
                >
                    {specialist.tagline}
                </div>
            </div>

            {/* Format (hidden on narrow) */}
            {!narrow && (
                <div style={{ ...MONO_LABEL_INK, fontSize: 11 }}>{formatLabel}</div>
            )}

            {/* Price */}
            <div
                style={{
                    fontFamily: GH_MONO,
                    fontSize: narrow ? 14 : 16,
                    fontWeight: 600,
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                }}
            >
                {specialist.basePriceGel}&nbsp;₾
            </div>
        </Link>
    );
}

// ────── Cabinets block ──────
function CabinetsBlock({ locations }: { locations: Location[] }) {
    const narrow = useNarrow(760);
    const active = locations.filter((l) => l.isActive !== false).slice(0, 4);

    if (active.length === 0) return null;

    return (
        <section id="cabinets" style={{ maxWidth: 1280, margin: '0 auto', padding: '80px clamp(16px, 4vw, 32px) 0' }}>
            <div style={{ ...MONO_LABEL, marginBottom: 12 }}>Филиалы · Кабинеты</div>
            <h2
                style={{
                    fontSize: 'clamp(36px, 4.5vw, 64px)',
                    fontWeight: 800,
                    lineHeight: 0.95,
                    letterSpacing: '-0.02em',
                    margin: 0,
                    marginBottom: 32,
                }}
            >
                Где принимают специалисты
            </h2>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: narrow ? '1fr' : `repeat(${Math.min(active.length, 2)}, 1fr)`,
                    gap: 0,
                    border: HAIRLINE,
                }}
            >
                {active.map((loc, i) => (
                    <CabinetCell key={loc.id} location={loc} num={i + 1} isLast={i === active.length - 1} narrow={narrow} total={active.length} />
                ))}
            </div>
        </section>
    );
}

function CabinetCell({
    location,
    num,
    isLast,
    narrow,
}: {
    location: Location;
    num: number;
    isLast: boolean;
    narrow: boolean;
    total: number;
}) {
    const [hover, setHover] = useState(false);
    return (
        <Link
            to={`/location/${location.id}`}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                padding: 24,
                borderRight: !narrow && !isLast ? HAIRLINE : undefined,
                borderBottom: narrow && !isLast ? HAIRLINE : undefined,
                textDecoration: 'none',
                color: GH.ink,
                background: hover ? GH.ink5 : 'transparent',
                transition: 'background 0.15s ease',
                fontFamily: GH_SANS,
            }}
        >
            <div style={{ ...MONO_LABEL, marginBottom: 16, fontVariantNumeric: 'tabular-nums' }}>
                {String(num).padStart(2, '0')} · Филиал
            </div>
            {/* Number / photo frame — typography-first, Vignelli-style */}
            <div
                style={{
                    border: HAIRLINE,
                    background: GH.paper,
                    marginBottom: 20,
                    aspectRatio: '16 / 10',
                    overflow: 'hidden',
                    position: 'relative',
                }}
            >
                {location.image ? (
                    <img
                        src={location.image}
                        alt={location.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                ) : (
                    <>
                        {/* Giant hairline number — fills the cell */}
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontFamily: GH_SANS,
                                fontWeight: 800,
                                fontSize: 'clamp(140px, 22vw, 280px)',
                                lineHeight: 0.8,
                                letterSpacing: '-0.04em',
                                color: GH.ink,
                                fontVariantNumeric: 'tabular-nums',
                                userSelect: 'none',
                            }}
                        >
                            {String(num).padStart(2, '0')}
                        </div>
                        {/* Corner mono meta */}
                        <div
                            style={{
                                position: 'absolute',
                                top: 12,
                                left: 12,
                                ...MONO_LABEL,
                                color: GH.ink60,
                            }}
                        >
                            Unbox · Филиал
                        </div>
                        <div
                            style={{
                                position: 'absolute',
                                bottom: 12,
                                right: 12,
                                ...MONO_LABEL,
                                color: GH.ink60,
                            }}
                        >
                            {location.isActive === false ? 'Закрыт' : 'Открыт'}
                        </div>
                    </>
                )}
            </div>
            <div
                style={{
                    fontSize: 26,
                    fontWeight: 800,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.1,
                    marginBottom: 8,
                }}
            >
                {location.name}
            </div>
            <div style={{ fontSize: 14, color: GH.ink60, lineHeight: 1.5, marginBottom: 16 }}>
                {location.address}
            </div>
            {location.description && (
                <div
                    style={{
                        fontSize: 14,
                        color: GH.ink60,
                        lineHeight: 1.55,
                        marginBottom: 16,
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                    }}
                >
                    {location.description}
                </div>
            )}
            <div style={{ ...MONO_LABEL_INK, borderTop: HAIRLINE, paddingTop: 16 }}>
                → Подробнее о филиале
            </div>
        </Link>
    );
}

// ────── Contact footer ──────
function ContactFooter() {
    return (
        <footer
            style={{
                maxWidth: 1280,
                margin: '80px auto 0',
                padding: '48px clamp(16px, 4vw, 32px) 40px',
                borderTop: HAIRLINE,
            }}
        >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 32, marginBottom: 40 }}>
                <ContactBlock label="Unbox One" value={<>ул. Палиашвили, 4<br/>Батуми, Грузия</>} />
                <ContactBlock label="Unbox Uni" value={<>ул. Тбел Абусеридзе, 38<br/>Батуми, Грузия</>} />
                <ContactBlock label="Телефон" value={<>+995 599 324 668<br/><span style={{ fontSize: 13, color: GH.ink60 }}>Telegram · WhatsApp</span></>} />
                <ContactBlock label="Почта" value="unbox.psy@gmail.com" />
                <ContactBlock label="Часы" value={<>Пн—Вс<br/>09:00 — 22:00</>} />
            </div>
            {/* Social links */}
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 32, ...MONO_LABEL }}>
                <a href="https://t.me/UnboxCenter" target="_blank" rel="noopener noreferrer" style={{ color: GH.ink60, textDecoration: 'none' }}>Telegram ↗</a>
                <a href="https://www.instagram.com/unbox.center/" target="_blank" rel="noopener noreferrer" style={{ color: GH.ink60, textDecoration: 'none' }}>Instagram ↗</a>
                <a href="https://www.facebook.com/UnboxYourself1" target="_blank" rel="noopener noreferrer" style={{ color: GH.ink60, textDecoration: 'none' }}>Facebook ↗</a>
            </div>
            <div
                style={{
                    borderTop: HAIRLINE,
                    paddingTop: 20,
                    display: 'flex',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                    ...MONO_LABEL,
                }}
            >
                <span>© 2026 Unbox · Пространство для практики</span>
                <span>Батуми · Грузия</span>
            </div>
        </footer>
    );
}

function ContactBlock({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div>
            <div style={{ ...MONO_LABEL, marginBottom: 10 }}>{label}</div>
            <div style={{ fontSize: 16, lineHeight: 1.45, color: GH.ink }}>{value}</div>
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// SPECIALIST ROUTE — minimalist block for specialist visitor mode
// ──────────────────────────────────────────────────────────────────────────
function SpecialistRoute({ onReset }: { onReset: () => void }) {
    const { currentUser } = useUserStore();
    const navigate = useNavigate();
    const { data: locations = [] } = useLocations();
    const isSpecialist = Boolean(currentUser && ['specialist', 'senior_admin', 'owner'].includes(currentUser.role ?? ''));

    return (
        <div style={PAGE_BG}>
            <Masthead mode="specialist" onReset={onReset} />
            <main>
                <section style={{ maxWidth: 1280, margin: '0 auto', padding: 'clamp(56px, 8vw, 112px) clamp(16px, 4vw, 32px)' }}>
                    <div style={{ ...MONO_LABEL, marginBottom: 32 }}>
                        Портал специалиста
                    </div>
                    <h1
                        style={{
                            fontSize: 'clamp(48px, 7vw, 104px)',
                            fontWeight: 800,
                            lineHeight: 0.92,
                            letterSpacing: '-0.025em',
                            margin: 0,
                            marginBottom: 36,
                            maxWidth: 1100,
                        }}
                    >
                        {currentUser ? (
                            <>
                                {currentUser.name?.split(' ')[0] ?? 'Специалист'},
                                <br />
                                добро пожаловать.
                            </>
                        ) : (
                            <>
                                Работайте в&nbsp;Unbox
                                <br />
                                на&nbsp;своих условиях.
                            </>
                        )}
                    </h1>
                    <p
                        style={{
                            fontSize: 'clamp(17px, 1.3vw, 20px)',
                            lineHeight: 1.55,
                            color: GH.ink60,
                            maxWidth: 640,
                            margin: 0,
                            marginBottom: 44,
                        }}
                    >
                        {currentUser
                            ? 'Аренда кабинетов, собственная страница, CRM для ведения практики. Выберите кабинет или перейдите в CRM.'
                            : 'Аренда кабинетов по часам, собственная страница на сайте Unbox, CRM для ведения практики. Подайте заявку, чтобы начать.'}
                    </p>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {currentUser ? (
                            <>
                                <HeroCta to="#cabinets" primary>
                                    Кабинеты Unbox →
                                </HeroCta>
                                {isSpecialist && (
                                    <HeroCta to="/crm">
                                        → В кабинет CRM
                                    </HeroCta>
                                )}
                            </>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    onClick={() => navigate('/login')}
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        letterSpacing: '0.18em',
                                        textTransform: 'uppercase',
                                        padding: '18px 28px',
                                        border: `1px solid ${GH.ink}`,
                                        background: GH.ink,
                                        color: GH.paper,
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                    }}
                                >
                                    → Войти
                                </button>
                                <HeroCta to="#cabinets">Кабинеты Unbox →</HeroCta>
                                <HeroCta to="/login?register=1">Подать заявку →</HeroCta>
                            </>
                        )}
                    </div>

                    {/* Info strip */}
                    <div
                        style={{
                            marginTop: 96,
                            border: HAIRLINE,
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
                        }}
                    >
                        {[
                            { num: '01', label: 'Кабинеты', body: '2 локации в центре Батуми, почасовая аренда, полная комплектация.' },
                            { num: '02', label: 'Практика', body: 'Собственная страница, расписание, запись клиентов через сайт.' },
                            { num: '03', label: 'CRM', body: 'Клиенты, сессии, заметки, финансы — в одном рабочем пространстве.' },
                        ].map((cell, i, arr) => (
                            <div
                                key={cell.num}
                                style={{
                                    padding: '28px 24px',
                                    borderRight: i < arr.length - 1 ? HAIRLINE : undefined,
                                }}
                            >
                                <div style={{ ...MONO_LABEL, marginBottom: 14 }}>
                                    {cell.num} · {cell.label}
                                </div>
                                <div style={{ fontSize: 15, lineHeight: 1.5, color: GH.ink }}>{cell.body}</div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Cabinets section — same as client landing */}
                <CabinetsBlock locations={locations} />
            </main>
            <ContactFooter />
        </div>
    );
}
