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
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

export function SpecialistProfilePage() {
    const { id } = useParams<{ id: string }>();
    const useGridHouse = useDesignFlag();
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

    const hasOnline = specialist.formats.includes('ONLINE');
    const hasOfflineRoom = specialist.formats.includes('OFFLINE_ROOM');
    const hasOfflineCapsule = specialist.formats.includes('OFFLINE_CAPSULE');

    // ─────────────────────────────────────────────────────────────────────
    // GRID HOUSE — экспериментальный вид всей страницы профиля.
    // Активируется через ?design=grid. Старый return ниже не трогается.
    // Полный откат: удалить этот if-блок и import'ы SpecialistBookingChessboardGrid + useSearchParams.
    // ─────────────────────────────────────────────────────────────────────
    if (useGridHouse) {
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
                                    55<br />МИН
                                </div>
                            </div>

                            {/* CTA */}
                            <Link to="/checkout" onClick={() => setStep(1)} style={{ textDecoration: 'none', display: 'block' }}>
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
                            </Link>

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
                                Вы будете перенаправлены в мастер<br />бронирования пространств Unbox.
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
                                            {[hasOnline && 'Онлайн', (hasOfflineRoom || hasOfflineCapsule) && 'Очно'].filter(Boolean).join(' · ')}
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
                                            {(hasOfflineRoom || hasOfflineCapsule) ? 'Тбилиси' : '—'}
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
                                            55 минут
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
                                    whiteSpace: 'pre-wrap',
                                    maxWidth: '640px',
                                }}>
                                    {specialist.bio || 'Специалист пока не добавил описание о себе.'}
                                </div>
                            </section>
                        </div>
                    </div>

                    {/* Chessboard (already in Grid House language) */}
                    <div style={{ marginTop: '104px' }}>
                        <SpecialistBookingChessboardGrid
                            specialistId={specialist.id}
                            specialistName={`${specialist.firstName} ${specialist.lastName}`}
                            formats={specialist.formats}
                            basePriceGel={specialist.basePriceGel}
                        />
                    </div>

                    {/* Footer: experiment strip */}
                    <div style={{
                        marginTop: '80px',
                        borderTop: `1px solid ${GH.ink}`,
                        paddingTop: '20px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontFamily: MONO,
                        fontSize: '10px',
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        color: GH.ink60,
                        flexWrap: 'wrap',
                        gap: '16px',
                    }}>
                        <span>UNBOX · ПРОФИЛЬ СПЕЦИАЛИСТА</span>
                        <Link
                            to={`/specialists/${id}`}
                            style={{
                                color: GH.ink,
                                textDecoration: 'underline',
                                textUnderlineOffset: '4px',
                            }}
                        >
                            ← ВЕРНУТЬСЯ К ОБЫЧНОМУ ДИЗАЙНУ
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="pt-24 pb-20 min-h-screen bg-unbox-light/30">
            <div className="max-w-5xl mx-auto px-6">

                {/* Back Link */}
                <Link to="/specialists" className="inline-flex items-center text-unbox-grey hover:text-unbox-dark mb-8 transition-colors">
                    <ArrowLeft size={20} className="mr-2" />
                    К списку специалистов
                </Link>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">

                    {/* Left Column: Photo & Sticky Action Card */}
                    <div className="lg:col-span-4 lg:col-start-1">
                        <div className="sticky top-28">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="bg-white rounded-[2rem] p-4 shadow-sm border border-unbox-light mb-6"
                            >
                                <div className="aspect-[4/5] rounded-[1.5rem] overflow-hidden bg-gradient-to-br from-unbox-light to-white relative mb-6">
                                    {specialist.photoUrl ? (
                                        <img
                                            src={specialist.photoUrl}
                                            alt={specialist.firstName}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-unbox-grey">
                                            <span className="text-6xl font-light">{specialist.firstName[0]}</span>
                                        </div>
                                    )}
                                    <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm">
                                        <CheckCircle size={14} className="text-emerald-500" />
                                        <span className="text-xs font-semibold text-unbox-dark">Проверен Unbox</span>
                                    </div>
                                </div>

                                <div className="text-center px-2">
                                    <div className="text-3xl font-bold text-unbox-dark mb-1">
                                        {specialist.basePriceGel} ₾ <span className="text-base font-normal text-unbox-grey">/ 55 мин</span>
                                    </div>
                                </div>
                            </motion.div>

                            {/* Booking CTA */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                            >
                                <Link to="/checkout" onClick={() => setStep(1)}>
                                    <Button size="lg" className="w-full h-14 text-lg rounded-2xl shadow-lg shadow-unbox-green/20 group">
                                        Записаться на сессию
                                        <Calendar className="ml-2 group-hover:scale-110 transition-transform" size={20} />
                                    </Button>
                                </Link>
                                <p className="text-center text-xs text-unbox-grey mt-4 px-4 leading-relaxed">
                                    Вы будете перенаправлены в мастер бронирования пространств Unbox.
                                </p>
                            </motion.div>
                        </div>
                    </div>

                    {/* Right Column: Details */}
                    <div className="lg:col-span-8 lg:col-start-5 space-y-10">

                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                            <h1 className="text-4xl sm:text-5xl font-bold text-unbox-dark mb-3 tracking-tight">
                                {specialist.firstName} {specialist.lastName}
                            </h1>
                            <p className="text-xl text-unbox-green font-medium mb-8">
                                {specialist.tagline}
                            </p>

                            <div className="flex flex-wrap gap-2 mb-8">
                                {hasOnline && (
                                    <span className="flex items-center gap-1.5 px-3 py-1.5 bg-unbox-light text-unbox-green rounded-lg text-sm font-medium">
                                        <Video size={16} /> Принимает онлайн
                                    </span>
                                )}
                                {(hasOfflineRoom || hasOfflineCapsule) && (
                                    <span className="flex items-center gap-1.5 px-3 py-1.5 bg-unbox-light text-unbox-dark rounded-lg text-sm font-medium">
                                        <MapPin size={16} /> Принимает очно (Тбилиси)
                                    </span>
                                )}
                            </div>
                        </motion.div>

                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                            <h3 className="text-2xl font-bold text-unbox-dark mb-6 flex items-center gap-2">
                                С чем я работаю
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {specialist.specializations.map((spec, idx) => (
                                    <span key={idx} className="px-4 py-2 bg-white border border-unbox-light text-unbox-dark rounded-xl text-sm font-medium shadow-sm">
                                        {spec}
                                    </span>
                                ))}
                            </div>
                        </motion.div>

                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                            <h3 className="text-2xl font-bold text-unbox-dark mb-6 flex items-center gap-2">
                                Обо мне
                            </h3>
                            <Card className="p-6 sm:p-8 bg-white/50 backdrop-blur-sm shadow-sm border-unbox-light">
                                <div className="prose prose-stone max-w-none text-unbox-grey leading-relaxed whitespace-pre-wrap">
                                    {specialist.bio || "Специалист пока не добавил описание о себе."}
                                </div>
                            </Card>
                        </motion.div>

                    </div>
                </div>

                {/* Grid House experiment banner */}
                {useGridHouse && (
                    <div
                        style={{
                            marginTop: '48px',
                            padding: '14px 20px',
                            background: '#0F0F10',
                            color: '#FAFAF7',
                            fontFamily: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
                            fontSize: '10px',
                            letterSpacing: '0.2em',
                            textTransform: 'uppercase',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '16px',
                            flexWrap: 'wrap',
                        }}
                    >
                        <span>UNBOX · СПЕЦИАЛИСТ</span>
                        <Link
                            to={`/specialists/${id}`}
                            style={{
                                color: '#FAFAF7',
                                textDecoration: 'underline',
                                textUnderlineOffset: '4px',
                            }}
                        >
                            ← ВЕРНУТЬСЯ К ОБЫЧНОМУ
                        </Link>
                    </div>
                )}

                {/* Quick-pick: next 5 free slots. Saves the client from scanning
                    the full 14-day grid just to answer "when can I see X?". */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
                    <NextAvailableSlots specialistId={specialist.id} />
                </motion.div>

                {/* Booking Chessboard */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                    {useGridHouse ? (
                        <SpecialistBookingChessboardGrid
                            specialistId={specialist.id}
                            specialistName={`${specialist.firstName} ${specialist.lastName}`}
                            formats={specialist.formats}
                            basePriceGel={specialist.basePriceGel}
                        />
                    ) : (
                        <SpecialistBookingChessboard
                            specialistId={specialist.id}
                            specialistName={`${specialist.firstName} ${specialist.lastName}`}
                            formats={specialist.formats}
                            basePriceGel={specialist.basePriceGel}
                        />
                    )}
                </motion.div>

                {/* Grid House hint for owners who don't know about the toggle */}
                {!useGridHouse && (
                    <div
                        style={{
                            marginTop: '24px',
                            textAlign: 'right',
                            fontFamily: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
                            fontSize: '10px',
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'rgba(15,15,16,0.3)',
                        }}
                    >
                        <Link to={`/specialists/${id}?design=grid`} style={{ color: 'inherit' }}>
                            → посмотреть Grid House превью
                        </Link>
                    </div>
                )}

            </div>
        </div>
    );
}
