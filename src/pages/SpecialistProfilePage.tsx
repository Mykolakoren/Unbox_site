import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Video, MapPin, Calendar, CheckCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { api } from '../api/client';
import type { Specialist } from '../components/Specialists/SpecialistCard';
import { useBookingStore } from '../store/bookingStore';
import { SpecialistBookingChessboard } from '../components/Specialists/SpecialistBookingChessboard';
import { SpecialistBookingChessboardGrid } from '../components/Specialists/SpecialistBookingChessboardGrid';
import { NextAvailableSlots } from '../components/Specialists/NextAvailableSlots';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
// 2026-06-13 owner: рендер структурированного текста вынесен в общий
// компонент StructuredText (переиспользуется новостями/статьями).
import { StructuredText } from '../components/StructuredText';
import { hasOnlineFormat, hasOfflineFormat } from '../utils/specialistFormat';

export function SpecialistProfilePage() {
    const { id } = useParams<{ id: string }>();
    const [specialist, setSpecialist] = useState<Specialist | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Grid House: track narrow viewport for responsive collapse
    const [isNarrowGH, setIsNarrowGH] = useState(() => typeof window !== 'undefined' && window.innerWidth < 960);
    useEffect(() => {
        const onResize = () => setIsNarrowGH(window.innerWidth < 960);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // To optionally pre-fill booking wizard
    const setStep = useBookingStore(s => s.setStep);

    useEffect(() => {
        const fetchSpecialist = async () => {
            try {
                const res = await api.get(`/specialists/${id}`);
                setSpecialist(res.data);
            } catch (err: any) {
                setError("Специалист не найден или страница удалена.");
            } finally {
                setIsLoading(false);
            }
        };
        fetchSpecialist();
    }, [id]);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-unbox-light/30 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-unbox-dark"></div>
            </div>
        );
    }

    if (error || !specialist) {
        return (
            <div className="min-h-screen bg-unbox-light/30 flex flex-col items-center justify-center p-6 text-center">
                <h2 className="text-2xl font-bold text-unbox-dark mb-4">Упс!</h2>
                <p className="text-unbox-grey mb-8">{error}</p>
                <Link to="/specialists">
                    <Button>Вернуться к списку</Button>
                </Link>
            </div>
        );
    }

    const hasOnline = hasOnlineFormat(specialist.formats);
    // Per-center offline tags (new in May 2026 — see CrmProfile FormatCheckbox).
    // If specialist hasn't migrated yet, legacy `OFFLINE_ROOM/_CAPSULE` keep
    // surfacing them as "офлайн в центрах Unbox" without a specific link.
    const PROFILE_LOCATIONS = [
        { tag: 'OFFLINE_UNBOX_ONE',  id: 'unbox_one',  label: 'Unbox One' },
        { tag: 'OFFLINE_UNBOX_UNI',  id: 'unbox_uni',  label: 'Unbox Uni' },
        { tag: 'OFFLINE_NEO_SCHOOL', id: 'neo_school', label: 'Neo School' },
    ];
    const selectedCenters = PROFILE_LOCATIONS.filter(l => specialist.formats.includes(l.tag));
    // 2026-06-24 fix: «Очно» не показывалось у большинства — в базе зоопарк
    // offline-кодов (OFFLINE, OFFLINE_ROOM, OFFLINE_TBEL, OFFLINE_PALIASHVILI,
    // OFFLINE_NEO, OFFLINE_UNBOX_*), а проверялись только некоторые. Ловим
    // ЛЮБОЙ код, начинающийся с OFFLINE — устойчиво к историческим вариантам.
    const hasAnyOffline = hasOfflineFormat(specialist.formats);

    // ─────────────────────────────────────────────────────────────────────
    // GRID HOUSE — экспериментальный вид всей страницы профиля.
    // Активируется через ?design=grid. Старый return ниже не трогается.
    // Полный откат: удалить этот if-блок и import'ы SpecialistBookingChessboardGrid + useSearchParams.
    // ─────────────────────────────────────────────────────────────────────
        const SANS = GH_SANS;
        const MONO = GH_MONO;
        const isNarrow = isNarrowGH;
        const monoLabel: React.CSSProperties = {
            fontFamily: MONO,
            fontSize: '10px',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: GH.ink60,
            fontWeight: 500,
        };
        const sectionHead: React.CSSProperties = {
            fontFamily: SANS,
            fontSize: '28px',
            fontWeight: 600,
            letterSpacing: '-0.015em',
            margin: 0,
            color: GH.ink,
        };

        return (
            <div style={{
                minHeight: '100vh',
                background: GH.paper,
                color: GH.ink,
                fontFamily: SANS,
                paddingTop: '104px',
                paddingBottom: '96px',
            }}>
                <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 32px' }}>

                    {/* Top bar: index / breadcrumb */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderTop: `1px solid ${GH.ink}`,
                        borderBottom: `1px solid ${GH.ink10}`,
                        padding: '14px 0',
                        marginBottom: '56px',
                        fontFamily: MONO,
                        fontSize: '10px',
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        color: GH.ink60,
                        gap: '16px',
                        flexWrap: 'wrap',
                    }}>
                        <Link to="/#specialists" style={{ color: GH.ink, textDecoration: 'none' }}>
                            ← К СПИСКУ СПЕЦИАЛИСТОВ
                        </Link>
                        <span style={{ color: GH.ink30 }}>
                            UNBOX · СПЕЦИАЛИСТ
                        </span>
                    </div>

                    {/* Main grid */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: isNarrow ? '1fr' : 'minmax(0, 4fr) minmax(0, 8fr)',
                        gap: isNarrow ? '48px' : '56px',
                        alignItems: 'start',
                    }}>

                        {/* LEFT: Sticky index card */}
                        <aside style={{
                            position: isNarrow ? 'static' : 'sticky',
                            top: '104px',
                            maxWidth: isNarrow ? '420px' : 'none',
                            width: '100%',
                        }}>

                            {/* Photo with hairline frame */}
                            <figure style={{
                                margin: 0,
                                border: `1px solid ${GH.ink}`,
                                padding: '10px',
                                background: GH.paper,
                            }}>
                                <div style={{
                                    aspectRatio: '4 / 5',
                                    background: GH.ink5,
                                    overflow: 'hidden',
                                    position: 'relative',
                                }}>
                                    {specialist.photoUrl ? (
                                        <img
                                            src={specialist.photoUrl}
                                            alt={`${specialist.firstName} ${specialist.lastName}`}
                                            style={{
                                                width: '100%',
                                                height: '100%',
                                                objectFit: 'cover',
                                                display: 'block',
                                            }}
                                        />
                                    ) : (
                                        <div style={{
                                            width: '100%',
                                            height: '100%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontFamily: SANS,
                                            fontSize: '96px',
                                            fontWeight: 700,
                                            color: GH.ink30,
                                        }}>
                                            {specialist.firstName[0]}
                                        </div>
                                    )}
                                </div>
                                <figcaption style={{
                                    marginTop: '10px',
                                    paddingTop: '10px',
                                    borderTop: `1px solid ${GH.ink10}`,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontFamily: MONO,
                                    fontSize: '9px',
                                    letterSpacing: '0.18em',
                                    textTransform: 'uppercase',
                                    color: GH.ink60,
                                }}>
                                    <span>ID · {specialist.id.slice(0, 6).toUpperCase()}</span>
                                    <span>✓ ПРОВЕРЕН UNBOX</span>
                                </figcaption>
                            </figure>

                            {/* Price block */}
                            <div style={{
                                borderLeft: `1px solid ${GH.ink}`,
                                borderRight: `1px solid ${GH.ink}`,
                                borderBottom: `1px solid ${GH.ink}`,
                                padding: '20px',
                                display: 'flex',
                                alignItems: 'baseline',
                                justifyContent: 'space-between',
                                gap: '12px',
                            }}>
                                <div>
                                    <div style={monoLabel}>СЕССИЯ</div>
                                    <div style={{
                                        fontFamily: SANS,
                                        fontSize: '48px',
                                        fontWeight: 700,
                                        lineHeight: 1,
                                        marginTop: '6px',
                                        letterSpacing: '-0.03em',
                                    }}>
                                        {specialist.basePriceGel} ₾
                                    </div>
                                </div>
                                <div style={{
                                    ...monoLabel,
                                    textAlign: 'right',
                                    color: GH.ink30,
                                }}>
                                    {specialist.sessionDurationMin ?? 50}<br />МИН
                                </div>
                            </div>

                            {/* CTA — scroll to the slot picker that lives lower
                                on this same page (#specialist-slots). Used to
                                navigate to /checkout (the cabinet-rental wizard)
                                which dropped users onto the specialist list — they
                                lost context entirely and asked "где же слоты?". */}
                            <a
                                href="#specialist-slots"
                                onClick={(e) => {
                                    e.preventDefault();
                                    const el = document.getElementById('specialist-slots');
                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }}
                                style={{ textDecoration: 'none', display: 'block' }}
                            >
                                <div
                                    style={{
                                        marginTop: '16px',
                                        background: GH.ink,
                                        color: GH.paper,
                                        padding: '22px 24px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '6px',
                                        border: `1px solid ${GH.ink}`,
                                        cursor: 'pointer',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = GH.accent; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = GH.ink; }}
                                >
                                    <span style={{
                                        fontFamily: MONO,
                                        fontSize: '9px',
                                        letterSpacing: '0.25em',
                                        textTransform: 'uppercase',
                                        opacity: 0.55,
                                    }}>
                                        → ЗАПИСЬ НА СЕССИЮ
                                    </span>
                                    <span style={{
                                        fontFamily: SANS,
                                        fontSize: '20px',
                                        fontWeight: 600,
                                        letterSpacing: '-0.01em',
                                    }}>
                                        Забронировать время
                                    </span>
                                </div>
                            </a>

                            <p style={{
                                marginTop: '14px',
                                marginBottom: 0,
                                fontFamily: MONO,
                                fontSize: '9px',
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                color: GH.ink30,
                                lineHeight: 1.7,
                            }}>
                                Доступные слоты — ниже на странице.
                            </p>
                        </aside>

                        {/* RIGHT: Content */}
                        <div>

                            {/* Name + tagline */}
                            <header style={{ marginBottom: '72px' }}>
                                <div style={monoLabel}>СПЕЦИАЛИСТ · 01</div>
                                <h1 style={{
                                    fontFamily: SANS,
                                    fontSize: 'clamp(48px, 6.5vw, 84px)',
                                    fontWeight: 700,
                                    lineHeight: 0.92,
                                    letterSpacing: '-0.035em',
                                    margin: '14px 0 28px',
                                    color: GH.ink,
                                }}>
                                    {specialist.firstName}<br />{specialist.lastName}
                                </h1>
                                <p style={{
                                    fontFamily: SANS,
                                    fontSize: '22px',
                                    fontWeight: 400,
                                    lineHeight: 1.4,
                                    color: GH.accent,
                                    maxWidth: '620px',
                                    margin: 0,
                                }}>
                                    {specialist.tagline}
                                </p>

                                {/* Format strip */}
                                <div style={{
                                    marginTop: '40px',
                                    display: 'grid',
                                    gridTemplateColumns: isNarrow ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))',
                                    borderTop: `1px solid ${GH.ink}`,
                                    borderBottom: `1px solid ${GH.ink10}`,
                                }}>
                                    <div style={{ padding: '18px 16px 18px 0', borderRight: `1px solid ${GH.ink10}` }}>
                                        <div style={monoLabel}>ФОРМАТ</div>
                                        <div style={{
                                            fontFamily: SANS,
                                            fontSize: '15px',
                                            fontWeight: 500,
                                            marginTop: '4px',
                                        }}>
                                            {[hasOnline && 'Онлайн', hasAnyOffline && 'Очно'].filter(Boolean).join(' · ') || '—'}
                                        </div>
                                    </div>
                                    <div style={{ padding: '18px 16px', borderRight: `1px solid ${GH.ink10}` }}>
                                        <div style={monoLabel}>ЛОКАЦИЯ</div>
                                        <div style={{
                                            fontFamily: SANS,
                                            fontSize: '15px',
                                            fontWeight: 500,
                                            marginTop: '4px',
                                        }}>
                                            {selectedCenters.length > 0 ? (
                                                selectedCenters.map((loc, i) => (
                                                    <span key={loc.id}>
                                                        <Link
                                                            to={`/location/${loc.id}`}
                                                            style={{ color: GH.ink, textDecoration: 'underline', textUnderlineOffset: 2 }}
                                                        >
                                                            {loc.label}
                                                        </Link>
                                                        {i < selectedCenters.length - 1 ? ', ' : ''}
                                                    </span>
                                                ))
                                            ) : hasAnyOffline ? (
                                                'Батуми'
                                            ) : '—'}
                                        </div>
                                    </div>
                                    <div style={{ padding: '18px 0 18px 16px' }}>
                                        <div style={monoLabel}>ДЛИТЕЛЬНОСТЬ</div>
                                        <div style={{
                                            fontFamily: SANS,
                                            fontSize: '15px',
                                            fontWeight: 500,
                                            marginTop: '4px',
                                        }}>
                                            {specialist.sessionDurationMin ?? 50} минут
                                        </div>
                                    </div>
                                </div>
                            </header>

                            {/* Practice section */}
                            <section style={{ marginBottom: '72px' }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    justifyContent: 'space-between',
                                    borderBottom: `1px solid ${GH.ink}`,
                                    paddingBottom: '14px',
                                    marginBottom: '8px',
                                    gap: '16px',
                                    flexWrap: 'wrap',
                                }}>
                                    <h2 style={sectionHead}>Практика</h2>
                                    <div style={monoLabel}>
                                        {String(specialist.specializations.length).padStart(2, '0')} НАПРАВЛЕНИЙ
                                    </div>
                                </div>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: isNarrow ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                                    columnGap: '32px',
                                }}>
                                    {specialist.specializations.map((spec, idx) => (
                                        <div key={idx} style={{
                                            display: 'flex',
                                            alignItems: 'baseline',
                                            gap: '16px',
                                            padding: '16px 0',
                                            borderBottom: `1px solid ${GH.ink10}`,
                                        }}>
                                            <span style={{
                                                fontFamily: MONO,
                                                fontSize: '10px',
                                                color: GH.ink30,
                                                flexShrink: 0,
                                                width: '22px',
                                                letterSpacing: '0.1em',
                                            }}>
                                                {String(idx + 1).padStart(2, '0')}
                                            </span>
                                            <span style={{
                                                fontFamily: SANS,
                                                fontSize: '16px',
                                                fontWeight: 500,
                                                lineHeight: 1.4,
                                            }}>
                                                {spec}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            {/* About section */}
                            <section>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    justifyContent: 'space-between',
                                    borderBottom: `1px solid ${GH.ink}`,
                                    paddingBottom: '14px',
                                    marginBottom: '28px',
                                    gap: '16px',
                                    flexWrap: 'wrap',
                                }}>
                                    <h2 style={sectionHead}>О себе</h2>
                                    <div style={monoLabel}>ОТ ПЕРВОГО ЛИЦА</div>
                                </div>
                                <div style={{
                                    fontFamily: SANS,
                                    fontSize: '17px',
                                    lineHeight: 1.7,
                                    color: GH.ink,
                                    maxWidth: '640px',
                                }}>
                                    {specialist.bio
                                        ? <StructuredText text={specialist.bio} />
                                        : 'Специалист пока не добавил описание о себе.'}
                                </div>
                            </section>
                        </div>
                    </div>

                    {/* Chessboard (already in Grid House language). The
                        ``id`` is the scroll target for the "Забронировать
                        время" CTA at the top of the page. */}
                    <div id="specialist-slots" style={{ marginTop: '104px', scrollMarginTop: '24px' }}>
                        <SpecialistBookingChessboardGrid
                            specialistId={specialist.id}
                            specialistName={`${specialist.firstName} ${specialist.lastName}`}
                            formats={specialist.formats}
                            basePriceGel={specialist.basePriceGel}
                        />
                    </div>

                    {/* Footer strip — A/B-test toggle removed (Grid House is
                        the only live design now). */}
                    <div style={{
                        marginTop: '80px',
                        borderTop: `1px solid ${GH.ink}`,
                        paddingTop: '20px',
                        fontFamily: MONO,
                        fontSize: '10px',
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        color: GH.ink60,
                    }}>
                        <span>UNBOX · ПРОФИЛЬ СПЕЦИАЛИСТА</span>
                    </div>
                </div>
            </div>
        );
}
