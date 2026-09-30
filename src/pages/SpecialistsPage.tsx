import { useState, useEffect, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { SpecialistCard } from '../components/Specialists/SpecialistCard';
import type { Specialist } from '../components/Specialists/SpecialistCard';
import { hasOnlineFormat, hasOfflineFormat, specializationLabels } from '../utils/specialistFormat';
import { api } from '../api/client';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { ruCountWord } from '../utils/plural';
import { Skeleton } from '../components/ui/Skeleton';
import { ErrorBar } from '../components/ui/ErrorBar';
import { EmptyState } from '../components/ui/EmptyState';
import { Chip } from '../components/ui/Chip';
import { PublicHeader } from '../components/public/PublicHeader';
import { apiErrorMessage } from '../utils/errors';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const FORMAT_FILTERS = [
    { key: 'all', label: 'Все' },
    { key: 'ONLINE', label: 'Онлайн' },
    { key: 'OFFLINE_ROOM', label: 'Очно' },
];

// 2026-06-06 owner: показываем ТОЛЬКО канонические роли, без
// auto-discovery из tagline. Полные подробности — в карточке.
const CORE_ROLES = ['Психолог', 'Коуч', 'Педагог', 'Тренер', 'Терапевт'];

/** Основа слова роли: «Психолог» ловит «КПТ-психолог», «Детский психолог»;
 *  «Терапевт» — «Гештальт-терапевт», «психотерапевт». */
function roleStem(role: string): string {
    return role.toLowerCase();
}

/** G2-09: роль ищем по вхождению основы в tagline и направлениях, без учёта
 *  регистра. Раньше — только «tagline начинается с роли», и «Гештальт-терапевт»
 *  не попадал ни в «Терапевта», ни в «Психолога». */
function matchesRole(s: Specialist, role: string): boolean {
    const stem = roleStem(role);
    if ((s.tagline || '').toLowerCase().includes(stem)) return true;
    return specializationLabels(s.specializations).some(sp => sp.toLowerCase().includes(stem));
}

export function SpecialistsPage() {
    useDocumentTitle('Специалисты');
    const [specialists, setSpecialists] = useState<Specialist[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [formatFilter, setFormatFilter] = useState('all');
    const [roleFilter, setRoleFilter] = useState('all');
    // Excel #56 — clickable specialisation chips. null = nothing selected.
    const [specFilter, setSpecFilter] = useState<string | null>(null);

    const fetchSpecialists = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.get('/specialists');
            setSpecialists(res.data);
        } catch (err: unknown) {
            setError(apiErrorMessage(err, 'Не удалось загрузить список специалистов.'));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchSpecialists();
    }, []);

    // Направления для фильтра: русские названия (G2-08), без «в профессии …»,
    // топ-15 по числу специалистов — больше становится свалкой.
    const allSpecializations = useMemo(() => {
        const counts = new Map<string, number>();
        specialists.forEach(s => {
            specializationLabels(s.specializations).forEach(label => {
                if (label.length < 3 || /в профессии/i.test(label)) return;
                counts.set(label, (counts.get(label) || 0) + 1);
            });
        });
        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([spec]) => spec);
    }, [specialists]);

    const filteredSpecialists = specialists.filter(s => {
        // «Очно» матчит ЛЮБОЙ offline-код (зоопарк в базе), «Онлайн» — ONLINE.
        if (formatFilter === 'ONLINE' && !hasOnlineFormat(s.formats)) return false;
        if (formatFilter === 'OFFLINE_ROOM' && !hasOfflineFormat(s.formats)) return false;
        if (roleFilter !== 'all' && !matchesRole(s, roleFilter)) return false;
        const labels = specializationLabels(s.specializations);
        if (specFilter && !labels.some(sp => sp.toLowerCase() === specFilter.toLowerCase())) return false;
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            s.firstName?.toLowerCase().includes(q) ||
            s.lastName?.toLowerCase().includes(q) ||
            s.tagline?.toLowerCase().includes(q) ||
            labels.some(spec => spec.toLowerCase().includes(q))
        );
    });

    const activeFilters = [
        formatFilter !== 'all' && FORMAT_FILTERS.find(f => f.key === formatFilter)?.label,
        roleFilter !== 'all' && roleFilter,
        specFilter,
        searchQuery && `«${searchQuery}»`,
    ].filter(Boolean) as string[];

    const resetFilters = () => {
        setFormatFilter('all');
        setRoleFilter('all');
        setSpecFilter(null);
        setSearchQuery('');
    };

    return (
        <GridHouseSpecialistsPage
            specialists={specialists} filteredSpecialists={filteredSpecialists}
            isLoading={isLoading} error={error} onRetry={fetchSpecialists}
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            formatFilter={formatFilter} setFormatFilter={setFormatFilter}
            roleFilter={roleFilter} setRoleFilter={setRoleFilter}
            roleFilters={CORE_ROLES}
            specFilter={specFilter} setSpecFilter={setSpecFilter}
            allSpecializations={allSpecializations}
            activeFilters={activeFilters}
            onResetFilters={resetFilters}
        />
    );
}


/* ═══════════════════════════════════════════════════════════════
   Grid House — SpecialistsPage
   ═══════════════════════════════════════════════════════════════ */

const ghspMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const };

interface GridHouseSpecialistsPageProps {
    specialists: Specialist[];
    filteredSpecialists: Specialist[];
    isLoading: boolean;
    error: string | null;
    onRetry: () => void;
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    formatFilter: string;
    setFormatFilter: (f: string) => void;
    roleFilter: string;
    setRoleFilter: (r: string) => void;
    roleFilters: string[];
    specFilter: string | null;
    setSpecFilter: (s: string | null) => void;
    allSpecializations: string[];
    activeFilters: string[];
    onResetFilters: () => void;
}

function GridHouseSpecialistsPage({
    specialists, filteredSpecialists, isLoading, error, onRetry,
    searchQuery, setSearchQuery, formatFilter, setFormatFilter,
    roleFilter, setRoleFilter, roleFilters,
    specFilter, setSpecFilter, allSpecializations,
    activeFilters, onResetFilters,
}: GridHouseSpecialistsPageProps) {
    // G2-07: на узком экране — две колонки с квадратным фото, а не лента
    // на 23 экрана (одна карточка 3:4 во всю ширину).
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 560);
    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 560);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);
    const gridColumns = narrow ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))';
    const gridGap = narrow ? 12 : 20;

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, minHeight: '100vh', background: GH.paper }}>
            {/* G2-17: общая шапка сайта — на телефоне «Меню» с Кабинетами и Тарифами. */}
            <PublicHeader />

            {/* ── Content ── */}
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px clamp(16px, 4vw, 24px) 0' }}>
                <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
                    Наши специалисты
                </h1>
                <p style={{ fontSize: 16, color: GH.ink60, margin: '0 0 24px' }}>
                    Найдите своего специалиста среди профессионалов, принимающих в пространствах Unbox или онлайн.
                </p>

                {/* Search + filters. G2-18: один стиль фильтров — общий Chip
                    (44 px на телефоне, aria-pressed). */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                    <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
                        <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: GH.ink60 }} />
                        <input
                            type="search"
                            aria-label="Поиск специалиста"
                            placeholder="Имя, запрос или метод"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="ui-input"
                            style={{ width: '100%', paddingLeft: 36, paddingRight: 44, borderRadius: 0 }}
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                aria-label="Очистить поиск"
                                style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: GH.ink60, width: 44, height: 44, display: 'grid', placeItems: 'center' }}
                            >
                                <X size={16} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                    <div className="ui-chip-row" role="group" aria-label="Формат приёма">
                        {FORMAT_FILTERS.map(f => (
                            <Chip key={f.key} selected={formatFilter === f.key} onClick={() => setFormatFilter(f.key)}>
                                {f.label}
                            </Chip>
                        ))}
                    </div>
                </div>

                {/* Excel #21 — role tabs shown even when a category is empty. */}
                {roleFilters.length > 0 && (
                    <div className="ui-chip-row" role="group" aria-label="Профиль" style={{ marginBottom: 12 }}>
                        <Chip selected={roleFilter === 'all'} onClick={() => setRoleFilter('all')}>Все</Chip>
                        {roleFilters.map(role => (
                            <Chip key={role} selected={roleFilter === role} onClick={() => setRoleFilter(role)}>
                                {role}
                            </Chip>
                        ))}
                    </div>
                )}

                {/* Excel #56 — направления свёрнуты в одну кнопку. */}
                {allSpecializations.length > 0 && (
                    <SpecFilterCompact
                        all={allSpecializations}
                        value={specFilter}
                        onChange={setSpecFilter}
                    />
                )}

                <div style={{ borderBottom: `2px solid ${GH.ink}`, padding: '8px 0 16px', marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    {/* Счётчик — только после ответа сервера (не «0 специалистов» во время загрузки). */}
                    {!isLoading && !error && (
                        <span style={{ ...ghspMono, color: GH.ink60 }}>
                            {filteredSpecialists.length === specialists.length
                                ? ruCountWord(specialists.length, ['специалист', 'специалиста', 'специалистов'])
                                : `${filteredSpecialists.length} из ${specialists.length}`
                            }
                        </span>
                    )}
                    {activeFilters.length > 0 && (
                        <button
                            type="button"
                            onClick={onResetFilters}
                            style={{ background: 'none', border: 'none', padding: '0 4px', minHeight: 44, cursor: 'pointer', fontFamily: GH_SANS, fontSize: 14, color: GH.ink, textDecoration: 'underline', textUnderlineOffset: 3 }}
                        >
                            Сбросить фильтры
                        </button>
                    )}
                </div>
            </div>

            {/* Grid */}
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 clamp(16px, 4vw, 24px)', paddingBottom: 80 }}>
                {isLoading ? (
                    <div role="status" aria-busy="true" style={{ display: 'grid', gridTemplateColumns: gridColumns, gap: gridGap }}>
                        <span className="sr-only">Загружаем специалистов…</span>
                        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={narrow ? 280 : 420} radius={0} />)}
                    </div>
                ) : error ? (
                    <ErrorBar message={error} onRetry={onRetry} />
                ) : filteredSpecialists.length === 0 ? (
                    // G2-09: пустой результат — со строкой фильтров и сбросом.
                    <EmptyState
                        title="Никого не нашлось"
                        hint={activeFilters.length > 0
                            ? `Сейчас выбрано: ${activeFilters.join(', ')}. Уберите часть фильтров.`
                            : 'Попробуйте изменить параметры поиска.'}
                        action={activeFilters.length > 0 ? { label: 'Сбросить фильтры', onClick: onResetFilters } : undefined}
                    />
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: gridColumns, gap: gridGap }}>
                        {filteredSpecialists.map(specialist => (
                            <SpecialistCard key={specialist.id} specialist={specialist} compact={narrow} />
                        ))}
                    </div>
                )}
            </div>

            {/* Footer */}
            <footer style={{ maxWidth: 1200, margin: '0 auto', borderTop: `2px solid ${GH.ink}`, padding: '16px clamp(16px, 4vw, 24px)', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ ...ghspMono, color: GH.ink60 }}>Unbox · 2026</span>
                <span style={{ ...ghspMono, color: GH.ink60 }}>Батуми · Грузия</span>
            </footer>
        </div>
    );
}


/**
 * Specialisation filter — compact mode.
 *
 * Одна кнопка «Направления (N)»; выбранное направление видно рядом, даже
 * когда список свёрнут. Раскрытый список — те же Chip, обычным регистром.
 */
function SpecFilterCompact({ all, value, onChange }: {
    all: string[];
    value: string | null;
    onChange: (s: string | null) => void;
}) {
    const [open, setOpen] = useState(false);

    return (
        <div style={{ marginBottom: 8 }}>
            <div className="ui-chip-row">
                <Chip aria-expanded={open} selected={false} aria-pressed={undefined} onClick={() => setOpen(o => !o)}>
                    {open ? 'Скрыть направления' : `Направления (${all.length})`}
                </Chip>
                {/* Always-visible active filter pill */}
                {value && (
                    <Chip selected onClick={() => onChange(null)} aria-label={`Сбросить направление «${value}»`}>
                        {value} <X size={14} aria-hidden="true" />
                    </Chip>
                )}
            </div>

            {open && (
                <div className="ui-chip-row" role="group" aria-label="Направления" style={{ marginTop: 8 }}>
                    {all.map(spec => (
                        <Chip key={spec} selected={value === spec} onClick={() => onChange(value === spec ? null : spec)}>
                            {spec}
                        </Chip>
                    ))}
                </div>
            )}
        </div>
    );
}
