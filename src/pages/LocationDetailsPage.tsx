import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useBookingStore } from '../store/bookingStore';
import { useUserStore } from '../store/userStore';
import { MinimalLayout } from '../components/MinimalLayout';
import { CABINET_SERVICES } from '../utils/data';
import { MapPin, Wifi, Coffee, Users, Shield, Ruler, ChevronRight, X, ChevronLeft, ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { PRICING_CONFIG } from '../utils/pricingConfig';

// Derive per-format display rate from space type + global config.
// Falls back to resource.hourlyRate if something is missing.
const deriveRate = (resource: { type: string; hourlyRate: number; groupRate?: number | null }, format: 'group' | 'intervision'): number => {
    const spaceType = resource.type === 'capsule' ? 'CAP' : 'ROOM';
    const code = format === 'group' ? 'GRP' : 'INTV';
    // Prefer explicit resource.groupRate for 'group' when set (legacy override), else config
    if (format === 'group' && typeof resource.groupRate === 'number' && resource.groupRate > 0) {
        return resource.groupRate;
    }
    return PRICING_CONFIG.base_rates[spaceType][code] ?? resource.hourlyRate;
};

export function LocationDetailsPage() {
        const { locationId: id } = useParams<{ locationId: string }>();
    const navigate = useNavigate();
    const { locations, resources, fetchLocations, fetchResources, setLocation, setStep, setHighlightedResourceId } = useBookingStore();
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [galleryIndex, setGalleryIndex] = useState(0);

    useEffect(() => {
        if (locations.length === 0) fetchLocations();
        if (resources.length === 0) fetchResources();
    }, [locations.length, resources.length, fetchLocations, fetchResources]);

    const location = locations.find(loc => loc.id === id);

    useEffect(() => {
        if (id) setLocation(id);
    }, [id, setLocation]);

    if (!location) {
        return (
            <MinimalLayout>
                <div className="flex justify-center py-20 text-unbox-dark font-medium">Загрузка локации...</div>
            </MinimalLayout>
        );
    }

    // Location resources (active only)
    const locationResources = resources.filter(r => r.locationId === id && r.isActive !== false);

    // Gallery photos — location image + all resource photos
    const locationPhotos = location.image ? [location.image] : [];
    const allResourcePhotos = locationResources.flatMap(r => r.photos || []);
    const allPhotos = [...locationPhotos, ...allResourcePhotos].length > 0
        ? [...locationPhotos, ...allResourcePhotos]
        : ['/img/offices/miniature_cab_1_pal.jpg', '/img/offices/cabinet_5_ira.jpg', '/img/offices/cabinet_7_liza.webp'];
    // Show up to 5 for the hero grid
    const heroPhotos = allPhotos.slice(0, 5);

    const handleBookResource = (resourceId: string) => {
        setHighlightedResourceId(resourceId);
        setStep(2);
        navigate('/checkout');
    };

    const openGallery = (index: number) => {
        setGalleryIndex(index);
        setGalleryOpen(true);
    };

    return (

        <GridHouseLocationDetails
            location={location} locationResources={locationResources}
            allPhotos={allPhotos} navigate={navigate}
            handleBookResource={handleBookResource}
            galleryOpen={galleryOpen} setGalleryOpen={setGalleryOpen}
            galleryIndex={galleryIndex} setGalleryIndex={setGalleryIndex}
        />
    );
}


/* ═══════════════════════════════════════════════════════════════
   Grid House — LocationDetailsPage
   ═══════════════════════════════════════════════════════════════ */

const ghldMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const };
const ghldHairline = `1px solid ${GH.ink10}`;

interface GridHouseLocationDetailsProps {
    location: any;
    locationResources: any[];
    allPhotos: string[];
    navigate: ReturnType<typeof useNavigate>;
    handleBookResource: (id: string) => void;
    galleryOpen: boolean;
    setGalleryOpen: (v: boolean) => void;
    galleryIndex: number;
    setGalleryIndex: (v: number | ((i: number) => number)) => void;
}

function GridHouseLocationDetails({
    location, locationResources, allPhotos, navigate: nav, handleBookResource,
    galleryOpen, setGalleryOpen, galleryIndex, setGalleryIndex,
}: GridHouseLocationDetailsProps) {
    const { currentUser, logout } = useUserStore();
    const isAdmin = Boolean(currentUser && ['admin', 'senior_admin', 'owner'].includes(currentUser.role ?? ''));
    const ghNavMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' };

    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 640);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, minHeight: '100vh', background: GH.paper }}>
            {/* GH Header */}
            <header style={{ borderBottom: ghldHairline, background: GH.paper, position: 'sticky', top: 0, zIndex: 40 }}>
                <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px clamp(16px, 4vw, 24px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <Link to="/" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: GH.ink, textDecoration: 'none' }}>Unbox</Link>
                        <span style={{ ...ghNavMono, color: GH.ink30 }}>·</span>
                        <button onClick={() => nav(-1)} style={{ ...ghNavMono, color: GH.ink60, background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0' }}>← НАЗАД</button>
                    </div>
                    <nav style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                        <Link to="/specialists" style={{ ...ghNavMono, padding: '4px 12px', color: GH.ink60, textDecoration: 'none' }}>Специалисты</Link>
                        <span style={{ ...ghNavMono, color: GH.ink30 }}>·</span>
                        <Link to="/#cabinets" style={{ ...ghNavMono, padding: '4px 12px', color: GH.ink, fontWeight: 700, textDecoration: 'none' }}>Кабинеты</Link>
                        {isAdmin && (<><span style={{ ...ghNavMono, color: GH.ink30 }}>·</span><Link to="/admin" style={{ ...ghNavMono, padding: '4px 12px', color: GH.ink60, textDecoration: 'none' }}>Админ</Link></>)}
                        <span style={{ ...ghNavMono, color: GH.ink30 }}>·</span>
                        {currentUser ? (
                            <><Link to="/dashboard" style={{ ...ghNavMono, padding: '4px 12px', color: GH.ink60, textDecoration: 'none' }}>{currentUser.name ?? 'Кабинет'}</Link>
                            <span style={{ ...ghNavMono, color: GH.ink30 }}>·</span>
                            <button onClick={() => { logout(); nav('/'); }} style={{ ...ghNavMono, padding: '4px 12px', color: GH.danger, background: 'transparent', border: 'none', cursor: 'pointer' }}>Выйти</button></>
                        ) : (
                            <Link to="/login" style={{ ...ghNavMono, padding: '4px 12px', color: GH.ink60, textDecoration: 'none' }}>Войти</Link>
                        )}
                    </nav>
                </div>
            </header>

            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px clamp(16px, 4vw, 24px) 80px', overflowX: 'hidden' }}>
                {/* Location header */}
                <div style={{ paddingBottom: 24, borderBottom: `2px solid ${GH.ink}`, marginBottom: 32 }}>
                    <div style={{ ...ghldMono, color: GH.ink30, marginBottom: 8 }}>ЛОКАЦИЯ</div>
                    <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
                        {location.name}
                    </h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: GH.ink60, fontSize: 14 }}>
                        <MapPin size={14} style={{ color: GH.accent }} />
                        {location.address}
                    </div>
                </div>

                {/* KPI strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 0, borderTop: ghldHairline, borderBottom: ghldHairline, marginBottom: 32 }}>
                    <div style={{ padding: '16px 16px 16px 0', borderRight: ghldHairline }}>
                        <div style={{ ...ghldMono, color: GH.ink30, marginBottom: 6 }}>КАБИНЕТОВ</div>
                        <div style={{ fontFamily: GH_MONO, fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 700, lineHeight: 1 }}>
                            {locationResources.length}
                        </div>
                    </div>
                    {locationResources.length > 0 && (
                        <div style={{ padding: '16px 16px 16px 16px' }}>
                            <div style={{ ...ghldMono, color: GH.ink30, marginBottom: 6 }}>ЦЕНА ОТ</div>
                            <div style={{ fontFamily: GH_MONO, fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 700, lineHeight: 1, color: GH.accent }}>
                                {Math.min(...locationResources.map(r => r.hourlyRate || 0))} ₾
                            </div>
                            <div style={{ fontSize: 12, color: GH.ink30, marginTop: 4 }}>в час</div>
                        </div>
                    )}
                </div>

                {/* Photo gallery strip */}
                {allPhotos.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 32, overflow: 'hidden' }}>
                        {allPhotos.slice(0, 4).map((photo, i) => (
                            <div
                                key={i}
                                onClick={() => { setGalleryIndex(i); setGalleryOpen(true); }}
                                style={{ flex: i === 0 ? '2 1 0' : '1 1 0', height: 200, cursor: 'pointer', overflow: 'hidden', position: 'relative' }}
                            >
                                <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                {i === 3 && allPhotos.length > 4 && (
                                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <span style={{ ...ghldMono, color: '#fff', fontSize: 12 }}>+{allPhotos.length - 4} ФОТО</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Description */}
                {location.description && (
                    <div style={{ marginBottom: 32 }}>
                        <div style={{ ...ghldMono, color: GH.ink30, marginBottom: 12 }}>О ЛОКАЦИИ</div>
                        <p style={{ fontSize: 15, color: GH.ink60, lineHeight: 1.7, maxWidth: 700 }}>
                            {location.description}
                        </p>
                    </div>
                )}

                {/* Features */}
                {location.features && location.features.length > 0 && (
                    <div style={{ marginBottom: 32 }}>
                        <div style={{ ...ghldMono, color: GH.ink30, marginBottom: 12 }}>УДОБСТВА</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {location.features.map((feat: string, i: number) => (
                                <span key={i} style={{ ...ghldMono, fontSize: 10, color: GH.ink60, padding: '6px 12px', border: ghldHairline }}>
                                    {feat.toUpperCase()}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Cabinets */}
                {locationResources.length > 0 && (
                    <div style={{ marginBottom: 48 }}>
                        <div style={{ ...ghldMono, color: GH.ink30, marginBottom: 16 }}>КАБИНЕТЫ И ПРОСТРАНСТВА</div>
                        <div style={{ border: ghldHairline }}>
                            {locationResources.map((resource, i) => (
                                <div
                                    key={resource.id}
                                    style={{
                                        display: narrow ? 'flex' : 'grid',
                                        flexDirection: narrow ? 'column' : undefined,
                                        gridTemplateColumns: narrow ? undefined : '1fr auto auto',
                                        gap: narrow ? 10 : 16,
                                        alignItems: narrow ? 'stretch' : 'center',
                                        padding: narrow ? '14px 16px' : '16px 20px',
                                        borderBottom: i < locationResources.length - 1 ? ghldHairline : 'none',
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: 15 }}>{resource.name}</div>
                                        <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                                            <span style={{ ...ghldMono, color: GH.ink30, fontSize: 9 }}>
                                                {resource.type === 'capsule' ? 'КАПСУЛА' : 'КАБИНЕТ'}
                                            </span>
                                            <span style={{ ...ghldMono, color: GH.ink30, fontSize: 9 }}>
                                                ДО {resource.capacity} ЧЕЛ.
                                            </span>
                                            {resource.area && (
                                                <span style={{ ...ghldMono, color: GH.ink30, fontSize: 9 }}>
                                                    {resource.area} М²
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{
                                        textAlign: narrow ? 'left' : 'right',
                                        whiteSpace: 'nowrap',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: narrow ? 'flex-start' : 'flex-end',
                                        gap: 4,
                                    }}>
                                        {resource.formats?.includes('individual') !== false && (
                                            <div style={{ fontFamily: GH_MONO, fontWeight: 700, fontSize: 16 }}>
                                                {resource.hourlyRate} ₾<span style={{ fontSize: 11, fontWeight: 500, color: GH.ink60 }}>/час</span>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: narrow ? 'flex-start' : 'flex-end' }}>
                                            {resource.formats?.includes('group') && (
                                                <span style={{
                                                    fontFamily: GH_MONO, fontSize: 11, color: GH.accent, fontWeight: 600,
                                                    background: `${GH.accent}10`, padding: '2px 8px', borderRadius: 4,
                                                }}>
                                                    группа: {deriveRate(resource, 'group')} ₾/час
                                                </span>
                                            )}
                                            {resource.formats?.includes('intervision') && (
                                                <span style={{
                                                    fontFamily: GH_MONO, fontSize: 11, color: '#6D28D9', fontWeight: 600,
                                                    background: 'rgba(109,40,217,0.08)', padding: '2px 8px', borderRadius: 4,
                                                }}>
                                                    интервизия: {deriveRate(resource, 'intervision')} ₾/час
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleBookResource(resource.id)}
                                        style={{
                                            padding: narrow ? '12px 20px' : '8px 20px',
                                            background: GH.ink, color: GH.paper,
                                            fontWeight: 700, fontSize: 12, fontFamily: GH_SANS, border: 'none', cursor: 'pointer',
                                            width: narrow ? '100%' : undefined,
                                            marginTop: narrow ? 4 : 0,
                                        }}
                                    >
                                        Забронировать →
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Footer */}
                <footer style={{ borderTop: `2px solid ${GH.ink}`, padding: '16px 0', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ ...ghldMono, color: GH.ink30 }}>UNBOX · 2026</span>
                    <span style={{ ...ghldMono, color: GH.ink10 }}>GRID HOUSE</span>
                </footer>
            </div>

            {/* Gallery modal — reuse existing */}
            {galleryOpen && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column' }} onClick={() => setGalleryOpen(false)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 24px', color: '#fff' }}>
                        <span style={{ ...ghldMono, color: '#fff', fontSize: 11 }}>{galleryIndex + 1} / {allPhotos.length}</span>
                        <button onClick={() => setGalleryOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={24} /></button>
                    </div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 64px', position: 'relative' }} onClick={e => e.stopPropagation()}>
                        <img src={allPhotos[galleryIndex]} alt="" style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
                        {galleryIndex > 0 && (
                            <button onClick={() => setGalleryIndex(i => i - 1)} style={{ position: 'absolute', left: 16, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: 12, cursor: 'pointer' }}>
                                <ChevronLeft size={24} />
                            </button>
                        )}
                        {galleryIndex < allPhotos.length - 1 && (
                            <button onClick={() => setGalleryIndex(i => i + 1)} style={{ position: 'absolute', right: 16, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: 12, cursor: 'pointer' }}>
                                <ChevronRight size={24} />
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
