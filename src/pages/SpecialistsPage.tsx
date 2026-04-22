import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Loader2, Filter, X } from 'lucide-react';
import { SpecialistCard } from '../components/Specialists/SpecialistCard';
import type { Specialist } from '../components/Specialists/SpecialistCard';
import { useUserStore } from '../store/userStore';
import { api } from '../api/client';
import { Layout } from '../components/Layout';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

const FORMAT_FILTERS = [
    { key: 'all', label: 'Все' },
    { key: 'ONLINE', label: 'Онлайн' },
    { key: 'OFFLINE_ROOM', label: 'Кабинет' },
];

const glassPanel: React.CSSProperties = {
    background: 'rgba(255,255,255,0.88)',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
};

export function SpecialistsPage() {
        const [specialists, setSpecialists] = useState<Specialist[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [formatFilter, setFormatFilter] = useState('all');
    const [roleFilter, setRoleFilter] = useState('all');
    // Excel #56 — clickable specialisation chips. null = nothing selected,
    // string = filter specialists whose `specializations[]` includes it.
    const [specFilter, setSpecFilter] = useState<string | null>(null);

    useEffect(() => {
        const fetchSpecialists = async () => {
            try {
                const res = await api.get('/specialists');
                setSpecialists(res.data);
            } catch (err: any) {
                console.error("Failed to fetch specialists:", err);
                setError(err.response?.data?.detail || "Не удалось загрузить список специалистов.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchSpecialists();
    }, []);

    // Excel #21 — always show the canonical role tabs even when the current
    // roster doesn't have anyone in a category yet. Extra roles found in
    // taglines are appended so we don't hide new professions.
    const CORE_ROLES = ['Психолог', 'Коуч', 'Педагог', 'Тренер', 'Терапевт'];

    const roleFilters = useMemo(() => {
        const found = new Map<string, number>();
        specialists.forEach(s => {
            const role = s.tagline?.split(',')[0]?.trim();
            if (role) found.set(role, (found.get(role) || 0) + 1);
        });
        // Start with core roles (always visible), then append discovered ones.
        const seen = new Set<string>();
        const ordered: string[] = [];
        for (const r of CORE_ROLES) {
            ordered.push(r);
            seen.add(r.toLowerCase());
        }
        Array.from(found.entries())
            .sort((a, b) => b[1] - a[1])
            .forEach(([r]) => {
                if (!seen.has(r.toLowerCase())) {
                    ordered.push(r);
                    seen.add(r.toLowerCase());
                }
            });
        return ordered;
    }, [specialists]);

    // Excel #56 — collect all specialisations across the roster for the
    // chip filter row. Sorted by popularity.
    const allSpecializations = useMemo(() => {
        const counts = new Map<string, number>();
        specialists.forEach(s => {
            (s.specializations || []).forEach(spec => {
                const clean = spec.trim();
                if (clean) counts.set(clean, (counts.get(clean) || 0) + 1);
            });
        });
        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([spec]) => spec);
    }, [specialists]);

    const filteredSpecialists = specialists.filter(s => {
        // Format filter
        if (formatFilter !== 'all' && !s.formats.includes(formatFilter)) return false;
        // Role filter — matches tagline starts with selected role
        if (roleFilter !== 'all' && !s.tagline?.toLowerCase().startsWith(roleFilter.toLowerCase())) return false;
        // Specialisation filter (Excel #56) — must include the selected chip
        if (specFilter && !(s.specializations || []).some(sp => sp.toLowerCase() === specFilter.toLowerCase())) return false;
        // Search
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            s.firstName?.toLowerCase().includes(q) ||
            s.lastName?.toLowerCase().includes(q) ||
            s.tagline?.toLowerCase().includes(q) ||
            s.specializations?.some(spec => spec.toLowerCase().includes(q))
        );
    });

    return (

        <GridHouseSpecialistsPage
            specialists={specialists} filteredSpecialists={filteredSpecialists}
            isLoading={isLoading} error={error}
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            formatFilter={formatFilter} setFormatFilter={setFormatFilter}
            roleFilter={roleFilter} setRoleFilter={setRoleFilter}
            roleFilters={roleFilters}
            specFilter={specFilter} setSpecFilter={setSpecFilter}
            allSpecializations={allSpecializations}
        />
    );
}


/* ═══════════════════════════════════════════════════════════════
   Grid House — SpecialistsPage
   ═══════════════════════════════════════════════════════════════ */

const ghspMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const };
const ghspHairline = `1px solid ${GH.ink10}`;

interface GridHouseSpecialistsPageProps {
    specialists: Specialist[];
    filteredSpecialists: Specialist[];
    isLoading: boolean;
    error: string | null;
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
}

function GridHouseSpecialistsPage({
    specialists, filteredSpecialists, isLoading, error,
    searchQuery, setSearchQuery, formatFilter, setFormatFilter,
    roleFilter, setRoleFilter, roleFilters,
    specFilter, setSpecFilter, allSpecializations,
}: GridHouseSpecialistsPageProps) {
    const { currentUser, logout } = useUserStore();
    const navigate = useNavigate();
    const isAdmin = Boolean(currentUser && ['admin', 'senior_admin', 'owner'].includes(currentUser.role ?? ''));

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, minHeight: '100vh', background: GH.paper }}>
            {/* ── GH Header ── */}
            <header style={{ borderBottom: ghspHairline, background: GH.paper, position: 'sticky', top: 0, zIndex: 40 }}>
                <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px clamp(16px, 4vw, 24px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Link to="/" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: GH.ink, textDecoration: 'none' }}>Unbox</Link>
                    <nav style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                        <span style={{ ...ghspMono, padding: '4px 12px', color: GH.ink, fontWeight: 700 }}>Специалисты</span>
                        <span aria-hidden style={{ color: GH.ink30, fontFamily: GH_MONO, fontSize: 10 }}>·</span>
                        <Link to="/#cabinets" style={{ ...ghspMono, padding: '4px 12px', color: GH.ink60, textDecoration: 'none', fontWeight: 400 }}>Кабинеты</Link>
                        <span aria-hidden style={{ color: GH.ink30, fontFamily: GH_MONO, fontSize: 10 }}>·</span>
                        <Link to="/subscriptions" style={{ ...ghspMono, padding: '4px 12px', color: GH.ink60, textDecoration: 'none', fontWeight: 400 }}>Тарифы</Link>
                        {isAdmin && (
                            <>
                                <span aria-hidden style={{ color: GH.ink30, fontFamily: GH_MONO, fontSize: 10 }}>·</span>
                                <Link to="/admin" style={{ ...ghspMono, padding: '4px 12px', color: GH.ink60, textDecoration: 'none', fontWeight: 400 }}>Админ</Link>
                            </>
                        )}
                        <span aria-hidden style={{ color: GH.ink30, fontFamily: GH_MONO, fontSize: 10 }}>·</span>
                        {currentUser ? (
                            <>
                                <Link to="/dashboard" style={{ ...ghspMono, padding: '4px 12px', color: GH.ink60, textDecoration: 'none', fontWeight: 400 }}>{currentUser.name ?? 'Кабинет'}</Link>
                                <span aria-hidden style={{ color: GH.ink30, fontFamily: GH_MONO, fontSize: 10 }}>·</span>
                                <button onClick={() => { logout(); navigate('/'); }} style={{ ...ghspMono, padding: '4px 12px', color: GH.danger, background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 400 }}>Выйти</button>
                            </>
                        ) : (
                            <Link to="/login" style={{ ...ghspMono, padding: '4px 12px', color: GH.ink60, textDecoration: 'none', fontWeight: 400 }}>Войти</Link>
                        )}
                    </nav>
                </div>
            </header>

            {/* ── Content ── */}
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '48px clamp(16px, 4vw, 24px) 0' }}>
                <div style={{ ...ghspMono, color: GH.ink30, marginBottom: 8 }}>СПЕЦИАЛИСТЫ</div>
                <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
                    Наши специалисты
                </h1>
                <p style={{ fontSize: 15, color: GH.ink60, marginBottom: 24 }}>
                    Найдите своего специалиста среди профессионалов, принимающих в пространствах Unbox или онлайн.
                </p>

                {/* Search + filters */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                    <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 0 }}>
                        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: GH.ink30 }} />
                        <input
                            type="text"
                            placeholder="Поиск по имени, запросу или методу..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{
                                width: '100%', padding: '10px 36px 10px 36px', fontSize: 14, fontFamily: GH_SANS,
                                border: ghspHairline, background: 'transparent', color: GH.ink, outline: 'none',
                            }}
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: GH.ink30 }}
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {FORMAT_FILTERS.map(f => (
                            <button
                                key={f.key}
                                onClick={() => setFormatFilter(f.key)}
                                style={{
                                    padding: '8px 12px', fontSize: 12, fontWeight: 600, fontFamily: GH_SANS, cursor: 'pointer',
                                    border: formatFilter === f.key ? `1px solid ${GH.ink}` : ghspHairline,
                                    background: formatFilter === f.key ? GH.ink : 'transparent',
                                    color: formatFilter === f.key ? GH.paper : GH.ink60,
                                }}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Excel #21 — role tabs (Психолог / Коуч / Педагог / Тренер / Терапевт)
                    shown even when a category is empty, so admins see all
                    categories and can add specialists into them. */}
                {roleFilters.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                        <button
                            onClick={() => setRoleFilter('all')}
                            style={{
                                padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: GH_SANS, cursor: 'pointer',
                                border: roleFilter === 'all' ? `1px solid ${GH.accent}` : ghspHairline,
                                background: roleFilter === 'all' ? GH.accent : 'transparent',
                                color: roleFilter === 'all' ? GH.paper : GH.ink60,
                            }}
                        >
                            Все профили
                        </button>
                        {roleFilters.map(role => (
                            <button
                                key={role}
                                onClick={() => setRoleFilter(role)}
                                style={{
                                    padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: GH_SANS, cursor: 'pointer',
                                    border: roleFilter === role ? `1px solid ${GH.accent}` : ghspHairline,
                                    background: roleFilter === role ? GH.accent : 'transparent',
                                    color: roleFilter === role ? GH.paper : GH.ink60,
                                }}
                            >
                                {role}
                            </button>
                        ))}
                    </div>
                )}

                {/* Excel #56 — specialisation tags as a second filter row. */}
                {allSpecializations.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                        <div style={{ ...ghspMono, color: GH.ink30, alignSelf: 'center', marginRight: 6 }}>Направление:</div>
                        <button
                            onClick={() => setSpecFilter(null)}
                            style={{
                                padding: '4px 10px', fontSize: 11, fontFamily: GH_MONO, letterSpacing: '0.08em',
                                cursor: 'pointer',
                                border: specFilter === null ? `1px solid ${GH.ink}` : ghspHairline,
                                background: specFilter === null ? GH.ink : 'transparent',
                                color: specFilter === null ? GH.paper : GH.ink60,
                                textTransform: 'uppercase' as const,
                            }}
                        >
                            Все
                        </button>
                        {allSpecializations.map(spec => {
                            const active = specFilter === spec;
                            return (
                                <button
                                    key={spec}
                                    onClick={() => setSpecFilter(active ? null : spec)}
                                    style={{
                                        padding: '4px 10px', fontSize: 11, fontFamily: GH_MONO, letterSpacing: '0.08em',
                                        cursor: 'pointer',
                                        border: active ? `1px solid ${GH.ink}` : ghspHairline,
                                        background: active ? GH.ink : 'transparent',
                                        color: active ? GH.paper : GH.ink60,
                                        textTransform: 'uppercase' as const,
                                    }}
                                >
                                    {spec}
                                </button>
                            );
                        })}
                    </div>
                )}

                <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 16, marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ ...ghspMono, color: GH.ink30 }}>
                        {filteredSpecialists.length === specialists.length
                            ? `${specialists.length} СПЕЦИАЛИСТОВ`
                            : `${filteredSpecialists.length} ИЗ ${specialists.length}`
                        }
                    </span>
                </div>
            </div>

            {/* Grid */}
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 clamp(16px, 4vw, 24px)', paddingBottom: 80 }}>
                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: '80px 0', color: GH.ink30 }}>
                        <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
                        <p style={{ fontSize: 13 }}>Загрузка специалистов...</p>
                    </div>
                ) : error ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: GH.danger, fontSize: 14 }}>
                        {error}
                    </div>
                ) : filteredSpecialists.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: GH.ink30 }}>
                        <p style={{ fontSize: 15, fontWeight: 600 }}>Ничего не найдено</p>
                        <p style={{ fontSize: 13, color: GH.ink30 }}>Попробуйте изменить параметры поиска</p>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 20 }}>
                        {filteredSpecialists.map(specialist => (
                            <SpecialistCard key={specialist.id} specialist={specialist} />
                        ))}
                    </div>
                )}
            </div>

            {/* Footer */}
            <footer style={{ maxWidth: 1200, margin: '0 auto', borderTop: `2px solid ${GH.ink}`, padding: '16px clamp(16px, 4vw, 24px)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ ...ghspMono, color: GH.ink30 }}>UNBOX · 2026</span>
                <span style={{ ...ghspMono, color: GH.ink10 }}>GRID HOUSE</span>
            </footer>
        </div>
    );
}
