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

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useLocations } from '../../hooks/useLocations';
import { useUserStore } from '../../store/userStore';
import { canBookCabinets } from '../../utils/permissions';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import type { Specialist } from '../Specialists/SpecialistCard';
import { getBadge } from '../../utils/specialistBadges';
import type { Location } from '../../types/index';
import { formatGel } from '../../utils/format';
import { ruCountWord, ruPlural } from '../../utils/plural';
import { hasOnlineFormat, hasOfflineFormat } from '../../utils/specialistFormat';
import { PublicHeader } from '../public/PublicHeader';
import { Skeleton } from '../ui/Skeleton';
import { ErrorBar } from '../ui/ErrorBar';
import { useSpecialistApplicationStatus } from '../../hooks/useSpecialistApplication';
import { usePostsAvailability } from '../../pages/content/usePostsAvailability';

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
// Wave 1: мелкие моно-подписи — 12 px (меньше нельзя), разрядка ≤ 0.06em,
// чтобы строка не разъехалась после увеличения кегля.
const MONO_LABEL: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 12,
    letterSpacing: '0.06em',
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
            {/* G1-13: у страницы не было h1 — для экранного диктора и поиска. */}
            <h1 className="sr-only">Unbox — кабинеты и специалисты в Батуми</h1>
            {/* Masthead — minimal. G1-03: справа «Войти» — экран выбора только
                выбирает, что показать, а вход был спрятан на следующем экране. */}
            <div
                style={{
                    borderBottom: HAIRLINE,
                    padding: '12px clamp(16px, 4vw, 32px)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    justifyContent: 'space-between',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', minWidth: 0 }}>
                    <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>Unbox</div>
                    {!narrow && <div style={MONO_LABEL}>Батуми · Пространство для практики</div>}
                </div>
                <Link
                    to="/login"
                    style={{
                        ...MONO_LABEL,
                        color: GH.ink,
                        fontWeight: 600,
                        textDecoration: 'none',
                        minHeight: 44,
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0 4px',
                    }}
                >
                    Войти
                </Link>
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
                    title="Я клиент"
                    tag="Ищу специалиста"
                    body="Психологи, терапевты, коучи и педагоги. Подобрать специалиста, посмотреть расписание, записаться на сессию очно в Батуми или онлайн."
                    cta="Найти специалиста"
                    onClick={() => onSelect('client')}
                    borderRight={!narrow}
                    borderBottom={narrow}
                />
                <GateColumn
                    title="Я специалист"
                    tag="Принимаю клиентов"
                    body="Аренда кабинетов, приём клиентов, CRM для ведения практики. Для специалистов, которые принимают в пространствах Unbox."
                    cta="Арендовать кабинет"
                    onClick={() => onSelect('specialist')}
                />
            </div>

            {/* Footer strip. X2-12: строку «Выберите режим, чтобы продолжить»
                убрали — кнопки сами говорят, что делают. */}
            <div
                style={{
                    borderTop: HAIRLINE,
                    padding: '16px clamp(16px, 4vw, 32px)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 16,
                    flexWrap: 'wrap',
                    ...MONO_LABEL,
                }}
            >
                <span>Батуми · Грузия</span>
                <span>unbox.com.ge</span>
            </div>
        </div>
    );
}

function GateColumn({
    title,
    tag,
    body,
    cta,
    onClick,
    borderRight,
    borderBottom,
}: {
    title: string;
    tag: string;
    body: string;
    cta: string;
    onClick: () => void;
    borderRight?: boolean;
    borderBottom?: boolean;
}) {
    const [hover, setHover] = useState(false);
    // G1-13 / X4-13: раньше outline:'none' прятал фокус, а инверсия была
    // только от мыши. Теперь та же инверсия и при фокусе с клавиатуры.
    const [focusVisible, setFocusVisible] = useState(false);
    const inverted = hover || focusVisible;
    return (
        <button
            type="button"
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onFocus={(e) => {
                // Старый Safari не знает :focus-visible — там считаем любой фокус видимым.
                let visible = true;
                try { visible = e.currentTarget.matches(':focus-visible'); } catch { /* нет поддержки */ }
                setFocusVisible(visible);
            }}
            onBlur={() => setFocusVisible(false)}
            style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: 'clamp(40px, 6vw, 72px) clamp(16px, 5vw, 56px)',
                borderRight: borderRight ? HAIRLINE : undefined,
                borderBottom: borderBottom ? HAIRLINE : undefined,
                background: inverted ? GH.ink : GH.paper,
                color: inverted ? GH.paper : GH.ink,
                cursor: 'pointer',
                textAlign: 'left',
                // G1-12: было 440 px — между текстом и кнопкой зияла пустота.
                minHeight: 360,
                fontFamily: GH_SANS,
                transition: 'background 0.15s ease, color 0.15s ease',
                border: 'none',
                width: '100%',
            }}
        >
            <div>
                {/* Excel #42 — admins wanted "small caption UNDER the big title"
                    ("Я клиент" + "Ищу специалиста" below). */}
                <div
                    style={{
                        fontSize: 'clamp(56px, 6.5vw, 92px)',
                        fontWeight: 600,
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
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        opacity: 0.8,
                        marginBottom: 24,
                    }}
                >
                    {tag}
                </div>
                <div style={{ fontSize: 17, lineHeight: 1.5, maxWidth: 420, opacity: 0.8 }}>{body}</div>
            </div>
            <div
                style={{
                    fontSize: 16,
                    fontWeight: 600,
                    marginTop: 40,
                    borderTop: `1px solid ${inverted ? 'rgba(250,250,247,0.25)' : GH.ink10}`,
                    paddingTop: 20,
                }}
            >
                {cta} →
            </div>
        </button>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// MASTHEAD — общая шапка сайта + строка режима (волна 2: G1-08, G1-21, X2-11)
// ──────────────────────────────────────────────────────────────────────────
// Раньше у лендинга была своя шапка, и на телефоне в ней оставалось только
// «Войти»: ни специалистов, ни кабинетов, ни тарифов. Теперь — PublicHeader
// (на телефоне «Меню» со Специалистами, Кабинетами и Тарифами), а второй
// строкой — переключатель режима и «Статьи» / «Новости», если в них есть
// публикации (G1-20: пустые разделы из меню убраны).
function Masthead({
    mode,
    onReset,
}: {
    mode: 'client' | 'specialist';
    onReset: () => void;
}) {
    const posts = usePostsAvailability();
    const modeLabel = mode === 'client' ? 'клиент' : 'специалист';
    const subLink: React.CSSProperties = {
        ...MONO_LABEL,
        color: GH.ink60,
        textDecoration: 'none',
        minHeight: 44,
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0 8px',
    };
    return (
        <PublicHeader
            subnav={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Excel #42 — переключатель режима виден на любой ширине. */}
                    <button
                        type="button"
                        onClick={onReset}
                        title="Сменить режим"
                        style={{
                            ...MONO_LABEL,
                            background: 'transparent',
                            border: `1px solid ${GH.ink10}`,
                            padding: '0 12px',
                            cursor: 'pointer',
                            color: GH.ink60,
                            minHeight: 44,
                            display: 'inline-flex',
                            alignItems: 'center',
                        }}
                    >
                        Режим: {modeLabel} ↔
                    </button>
                    {posts.article && <Link to="/articles" style={subLink}>Статьи</Link>}
                    {posts.news && <Link to="/news" style={subLink}>Новости</Link>}
                </div>
            }
        />
    );
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

const SPECIALIST_FORMS: [string, string, string] = ['специалист', 'специалиста', 'специалистов'];

function ClientLanding({ onReset }: { onReset: () => void }) {
    const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
    // Волна 2 (G1-06): список грузим один раз целиком и фильтруем здесь.
    // Раньше каждый фильтр был отдельным запросом, и число в заголовке
    // бралось из отфильтрованного списка («1 специалистов»), а до ответа —
    // из запасного «17». null — ещё не загрузили.
    const [specialists, setSpecialists] = useState<Specialist[] | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const { data: locations = [] } = useLocations();

    const load = () => {
        setLoadFailed(false);
        api
            .get<Specialist[]>('/specialists')
            .then((r) => setSpecialists(r.data))
            .catch(() => setLoadFailed(true));
    };
    useEffect(load, []);

    // Категории без специалистов в фильтре не показываем («Наркология · 0»).
    const categories = useMemo(
        () => CATEGORIES.filter((c) => (specialists ?? []).some((s) => s.category === c.value)),
        [specialists],
    );
    const shown = useMemo(
        () => (specialists ?? []).filter((s) => !categoryFilter || s.category === categoryFilter),
        [specialists, categoryFilter],
    );

    return (
        <div style={PAGE_BG}>
            <Masthead mode="client" onReset={onReset} />
            <main>
                <Hero totalSpecialists={specialists ? specialists.length : null} locations={locations} />
                {/* G1-07 / X3-20: полоса «08 специалистов · 02 кабинета · 05 категорий · ∞»
                    убрана — KPI-плашки под героем, да ещё «2 кабинета» вместо двух центров. */}
                {categories.length > 1 && (
                    <CategoryStrip categories={categories} active={categoryFilter} onChange={setCategoryFilter} />
                )}
                <SpecialistIndex
                    specialists={shown}
                    loading={specialists === null && !loadFailed}
                    failed={specialists === null && loadFailed}
                    onRetry={load}
                    categoryFilter={categoryFilter}
                />
                <CabinetsBlock locations={locations} />
                <ContactFooter />
            </main>
        </div>
    );
}

// ────── Hero ──────
function Hero({ totalSpecialists, locations }: { totalSpecialists: number | null; locations: Location[] }) {
    const centers = locations.filter((l) => l.isActive !== false).length;
    return (
        <section
            style={{
                maxWidth: 1280,
                margin: '0 auto',
                padding: 'clamp(40px, 9vw, 120px) clamp(16px, 4vw, 32px) clamp(40px, 6vw, 80px)',
                borderBottom: HAIRLINE,
            }}
        >
            <div style={{ ...MONO_LABEL, marginBottom: 32 }}>
                Терапия · Психиатрия · Коучинг · Педагогика
            </div>
            <h1
                style={{
                    fontSize: 'clamp(36px, 8vw, 124px)',
                    fontWeight: 600,
                    lineHeight: 0.92,
                    letterSpacing: '-0.025em',
                    margin: 0,
                    marginBottom: 36,
                    maxWidth: 1100,
                    overflowWrap: 'break-word',
                    wordBreak: 'break-word',
                }}
            >
                {/* Число — только настоящее, после ответа сервера (без запасного «17»). */}
                {totalSpecialists ? ruCountWord(totalSpecialists, SPECIALIST_FORMS) : 'Специалисты'}
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
                {/* G1-07: locations — это центры (Unbox One, Unbox Uni), не кабинеты. */}
                Психологи, терапевты, коучи и педагоги принимают{' '}
                {centers > 0
                    ? <>в&nbsp;{centers}&nbsp;{ruPlural(centers, ['центре', 'центрах', 'центрах'])} Unbox</>
                    : <>в&nbsp;центрах Unbox</>}{' '}
                в&nbsp;Батуми или онлайн из&nbsp;любой точки мира. Выбор специалиста, запись на&nbsp;сессию
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

// G1-12: главные кнопки были 12 px моно-капсом с разрядкой 0.18em —
// самый слабый элемент экрана. Теперь 16 px, обычный регистр, 48 px высотой.
const HERO_CTA_BASE: React.CSSProperties = {
    fontFamily: GH_SANS,
    fontSize: 16,
    letterSpacing: 0,
    textDecoration: 'none',
    padding: '0 24px',
    minHeight: 48,
    border: `1px solid ${GH.ink}`,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
};

function HeroCta({ to, primary, children }: { to: string; primary?: boolean; children: React.ReactNode }) {
    const [hover, setHover] = useState(false);
    const style: React.CSSProperties = {
        ...HERO_CTA_BASE,
        background: primary ? (hover ? GH.accent : GH.ink) : hover ? GH.ink : 'transparent',
        color: primary ? GH.paper : hover ? GH.paper : GH.ink,
        transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
        borderColor: primary && hover ? GH.accent : GH.ink,
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

// ────── Category strip ──────
function CategoryStrip({
    categories,
    active,
    onChange,
}: {
    categories: ReadonlyArray<{ value: string; label: string }>;
    active: string | null;
    onChange: (v: string | null) => void;
}) {
    const narrow = useNarrow(760);
    const total = categories.length + 1;

    return (
        <section
            id="specialists"
            style={{
                maxWidth: 1280,
                margin: '0 auto',
                padding: '56px clamp(16px, 4vw, 32px) 0',
            }}
        >
            <div style={{ ...MONO_LABEL, marginBottom: 20 }} id="landing-category-label">Категория</div>
            <div
                role="group"
                aria-labelledby="landing-category-label"
                style={{
                    border: HAIRLINE,
                    display: 'grid',
                    gridTemplateColumns: narrow ? '1fr 1fr' : `repeat(${total}, 1fr)`,
                }}
            >
                <CategoryCell
                    label="Все"
                    isActive={active === null}
                    onClick={() => onChange(null)}
                    narrow={narrow}
                    index={0}
                    total={total}
                />
                {categories.map((c, i) => (
                    <CategoryCell
                        key={c.value}
                        label={c.label}
                        isActive={active === c.value}
                        onClick={() => onChange(c.value === active ? null : c.value)}
                        narrow={narrow}
                        index={i + 1}
                        total={total}
                    />
                ))}
            </div>
        </section>
    );
}

function CategoryCell({
    label,
    isActive,
    onClick,
    narrow,
    index,
    total,
}: {
    label: string;
    isActive: boolean;
    onClick: () => void;
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
            aria-pressed={isActive}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                padding: '14px 18px',
                minHeight: 56,
                borderRight: rightBorder ? HAIRLINE : undefined,
                borderBottom: bottomBorder ? HAIRLINE : undefined,
                background: isActive ? GH.ink : hover ? GH.ink5 : 'transparent',
                color: isActive ? GH.paper : GH.ink,
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                transition: 'background 0.15s ease, color 0.15s ease',
                width: '100%',
                fontFamily: GH_SANS,
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: '-0.005em',
            }}
        >
            {label}
        </button>
    );
}

// ────── Specialist index ──────
function SpecialistIndex({
    specialists,
    loading,
    failed,
    onRetry,
    categoryFilter,
}: {
    specialists: Specialist[];
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
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
                    <div style={{ ...MONO_LABEL, marginBottom: 12 }}>Специалисты Unbox</div>
                    <h2
                        style={{
                            fontSize: 'clamp(36px, 4.5vw, 64px)',
                            fontWeight: 600,
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
                {!loading && !failed && (
                    <div style={{ ...MONO_LABEL_INK, fontVariantNumeric: 'tabular-nums' }}>
                        {ruCountWord(specialists.length, SPECIALIST_FORMS)}
                    </div>
                )}
            </div>

            {failed ? (
                <ErrorBar message="Не удалось загрузить специалистов" onRetry={onRetry} />
            ) : (
                <div style={{ border: HAIRLINE, borderBottom: 'none' }}>
                    {/* Header row */}
                    {!narrow && (
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '104px 1fr 180px 140px',
                                alignItems: 'center',
                                padding: '14px 20px',
                                borderBottom: HAIRLINE,
                                background: GH.ink5,
                                ...MONO_LABEL,
                            }}
                        >
                            <div>Фото</div>
                            <div>Имя · Специализация</div>
                            <div>Формат</div>
                            <div style={{ textAlign: 'right' }}>Сессия</div>
                        </div>
                    )}

                    {loading && (
                        <div role="status" aria-busy="true">
                            <span className="sr-only">Загружаем специалистов…</span>
                            {Array.from({ length: 4 }, (_, i) => (
                                <div key={i} style={{ padding: narrow ? 16 : '18px 20px', borderBottom: HAIRLINE }}>
                                    <Skeleton height={narrow ? 76 : 112} radius={0} />
                                </div>
                            ))}
                        </div>
                    )}

                    {!loading && specialists.length === 0 && (
                        <div
                            style={{
                                padding: '48px 20px',
                                textAlign: 'center',
                                borderBottom: HAIRLINE,
                                fontSize: 16,
                                color: GH.ink60,
                            }}
                        >
                            {categoryFilter ? 'В этой категории пока никого нет' : 'Список специалистов скоро появится'}
                        </div>
                    )}

                    {!loading &&
                        specialists.map((s) => (
                            <SpecialistRow key={s.id} specialist={s} narrow={narrow} />
                        ))}
                </div>
            )}
        </section>
    );
}

function SpecialistRow({ specialist, narrow }: { specialist: Specialist; narrow: boolean }) {
    const [hover, setHover] = useState(false);
    const formats = specialist.formats ?? [];
    // Любой OFFLINE-код — очно (раньше проверялись только два кода из десятка).
    const hasOnline = hasOnlineFormat(formats);
    const hasOffline = hasOfflineFormat(formats);
    const formatLabel = [hasOffline && 'Очно', hasOnline && 'Онлайн'].filter(Boolean).join(' · ') || '—';
    const price = specialist.basePriceGel > 0 ? specialist.basePriceGel : null;

    const rowStyle: React.CSSProperties = {
        display: 'grid',
        gridTemplateColumns: narrow ? '72px 1fr auto' : '104px 1fr 180px 140px',
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
                        alt=""
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                ) : (
                    <div
                        aria-hidden="true"
                        style={{
                            width: '100%',
                            height: '100%',
                            background: GH.cellDead,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 20,
                            fontWeight: 600,
                            color: GH.ink60,
                        }}
                    >
                        {(specialist.firstName?.[0] || '').toUpperCase()}
                    </div>
                )}
            </div>

            {/* Name + tagline */}
            <div style={{ paddingLeft: narrow ? 14 : 20, minWidth: 0 }}>
                {(specialist.badges || []).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                        {(specialist.badges || []).map(code => {
                            const b = getBadge(code);
                            if (!b) return null;
                            return (
                                <span key={code} style={{
                                    fontFamily: GH_MONO, fontSize: 12, fontWeight: 600,
                                    letterSpacing: '0.05em', textTransform: 'uppercase',
                                    padding: '2px 6px', color: b.fg, background: b.bg,
                                    border: `1px solid ${b.border}`, lineHeight: 1.3,
                                }}>{b.label}</span>
                            );
                        })}
                    </div>
                )}
                <div
                    style={{
                        fontSize: narrow ? 17 : 22,
                        fontWeight: 600,
                        letterSpacing: '-0.01em',
                        lineHeight: 1.15,
                        marginBottom: 6,
                    }}
                >
                    {specialist.firstName} {specialist.lastName}
                </div>
                <div
                    style={{
                        fontSize: 14,
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
                {narrow && formatLabel !== '—' && (
                    <div style={{ ...MONO_LABEL, color: GH.ink60, marginTop: 6 }}>{formatLabel}</div>
                )}
            </div>

            {/* Format (desktop) */}
            {!narrow && (
                <div style={MONO_LABEL_INK}>{formatLabel}</div>
            )}

            {/* Price. G1-24: «от 140 ₾ · за сессию» — иначе непонятно, за что
                цена; без цены (0) — не показываем, как в /m/specialists. */}
            <div style={{ textAlign: 'right', paddingLeft: 8 }}>
                {price !== null && (
                    <>
                        <div className="num"
                            style={{
                                fontFamily: GH_MONO,
                                fontSize: narrow ? 14 : 16,
                                fontWeight: 600,
                                fontVariantNumeric: 'tabular-nums',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            от {formatGel(price)}
                        </div>
                        <div style={{ fontSize: 12, color: GH.ink60, marginTop: 2 }}>за сессию</div>
                    </>
                )}
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
                    fontWeight: 600,
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
            <div style={{ ...MONO_LABEL, marginBottom: 16 }}>
                Филиал
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
                                fontWeight: 600,
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
                    fontWeight: 600,
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
    const posts = usePostsAvailability();
    const navLink: React.CSSProperties = {
        color: GH.ink60,
        textDecoration: 'none',
        minHeight: 44,
        display: 'inline-flex',
        alignItems: 'center',
    };
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
                <ContactBlock label="Телефон" value={<>+995 599 324 668<br/><span style={{ fontSize: 14, color: GH.ink60 }}>Telegram · WhatsApp</span></>} />
                <ContactBlock label="Почта" value="unbox.psy@gmail.com" />
                <ContactBlock label="Часы" value={<>Пн—Вс<br/>09:00 — 22:00</>} />
            </div>
            {/* X2-11: все разделы сайта — и в подвале, чтобы с телефона до них
                было дойти без меню. «Статьи» и «Новости» — только если там есть
                публикации (G1-20). */}
            <nav aria-label="Разделы сайта" style={{ display: 'flex', gap: '0 24px', flexWrap: 'wrap', marginBottom: 16, ...MONO_LABEL }}>
                <Link to="/specialists" style={navLink}>Специалисты</Link>
                <a href="#cabinets" style={navLink}>Кабинеты</a>
                <Link to="/subscriptions" style={navLink}>Тарифы</Link>
                {posts.article && <Link to="/articles" style={navLink}>Статьи</Link>}
                {posts.news && <Link to="/news" style={navLink}>Новости</Link>}
                <Link to="/booking-rules" style={navLink}>Правила бронирования</Link>
            </nav>
            <div
                style={{
                    display: 'flex',
                    gap: '0 24px',
                    flexWrap: 'wrap',
                    marginBottom: 32,
                    ...MONO_LABEL,
                }}
            >
                <a href="https://t.me/UnboxCenter" target="_blank" rel="noopener noreferrer" style={navLink}>Telegram ↗</a>
                <a href="https://www.instagram.com/unbox.center/" target="_blank" rel="noopener noreferrer" style={navLink}>Instagram ↗</a>
                <a href="https://www.facebook.com/UnboxYourself1" target="_blank" rel="noopener noreferrer" style={navLink}>Facebook ↗</a>
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
    // G1-landing-entry-M3: вошедший без одобренной анкеты (роль user) раньше
    // видел «Выберите кабинет» — а бронь ему не дадут. Теперь — анкета.
    const canBook = canBookCabinets(currentUser);
    const application = useSpecialistApplicationStatus(currentUser, !!currentUser && !canBook);
    const needsApplication = !!currentUser && !canBook;
    const applicationPending = needsApplication && application === 'pending';

    const lead = !currentUser
        ? 'Аренда кабинетов по часам, собственная страница на сайте Unbox, CRM для ведения практики. Подайте заявку, чтобы начать.'
        : applicationPending
            ? 'Анкета на проверке. Как только администратор её одобрит, здесь откроется бронирование кабинетов.'
            : needsApplication
                ? 'Чтобы бронировать кабинеты, заполните анкету специалиста — после одобрения откроется бронирование.'
                : 'Аренда кабинетов, собственная страница, CRM для ведения практики. Выберите кабинет или перейдите в CRM.';

    return (
        <div style={PAGE_BG}>
            <Masthead mode="specialist" onReset={onReset} />
            <main>
                <section style={{ maxWidth: 1280, margin: '0 auto', padding: 'clamp(40px, 8vw, 112px) clamp(16px, 4vw, 32px)' }}>
                    <div style={{ ...MONO_LABEL, marginBottom: 32 }}>
                        Портал специалиста
                    </div>
                    <h1
                        style={{
                            fontSize: 'clamp(48px, 7vw, 104px)',
                            fontWeight: 600,
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
                        {lead}
                    </p>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {currentUser ? (
                            needsApplication ? (
                                <>
                                    <HeroCta to="/become-specialist" primary>
                                        {applicationPending ? 'Статус анкеты →' : 'Заполнить анкету →'}
                                    </HeroCta>
                                    <HeroCta to="#cabinets">Кабинеты Unbox →</HeroCta>
                                    <HeroCta to="/subscriptions">Тарифы и цены →</HeroCta>
                                </>
                            ) : (
                                <>
                                    <HeroCta to="#cabinets" primary>
                                        Кабинеты Unbox →
                                    </HeroCta>
                                    {isSpecialist && (
                                        <HeroCta to="/crm">
                                            В кабинет CRM →
                                        </HeroCta>
                                    )}
                                    <HeroCta to="/subscriptions">Тарифы и цены →</HeroCta>
                                </>
                            )
                        ) : (
                            <>
                                <button
                                    type="button"
                                    onClick={() => navigate('/login')}
                                    style={{ ...HERO_CTA_BASE, background: GH.ink, color: GH.paper }}
                                >
                                    Войти →
                                </button>
                                {/* Регистрация, а после неё — сразу анкета специалиста
                                    (раньше после регистрации человек попадал в кабинет
                                    клиента, и с телефона анкету было не найти). */}
                                <HeroCta to={`/login?register=1&redirect=${encodeURIComponent('/become-specialist')}`}>Подать заявку →</HeroCta>
                                {/* X2-11: цены аренды — отсюда, с телефона тоже. */}
                                <HeroCta to="/subscriptions">Тарифы и цены →</HeroCta>
                                <HeroCta to="#cabinets">Кабинеты Unbox →</HeroCta>
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
                            { label: 'Кабинеты', body: '2 центра в Батуми, почасовая аренда, полная комплектация. Цены — на странице «Тарифы».' },
                            { label: 'Практика', body: 'Собственная страница, расписание, запись клиентов через сайт.' },
                            { label: 'CRM', body: 'Клиенты, сессии, заметки, финансы — в одном рабочем пространстве.' },
                        ].map((cell, i, arr) => (
                            <div
                                key={cell.label}
                                style={{
                                    padding: '28px 24px',
                                    borderRight: i < arr.length - 1 ? HAIRLINE : undefined,
                                }}
                            >
                                <div style={{ ...MONO_LABEL, marginBottom: 14 }}>
                                    {cell.label}
                                </div>
                                <div style={{ fontSize: 16, lineHeight: 1.5, color: GH.ink }}>{cell.body}</div>
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
