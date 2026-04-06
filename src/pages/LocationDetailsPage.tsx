import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useBookingStore } from '../store/bookingStore';
import { MinimalLayout } from '../components/MinimalLayout';
import { CABINET_SERVICES } from '../utils/data';
import { MapPin, Wifi, Coffee, Users, Shield, Ruler, ChevronRight, X, ChevronLeft, ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

export function LocationDetailsPage() {
    const gridHouse = useDesignFlag();
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

    if (gridHouse) return (
        <GridHouseLocationDetails
            location={location} locationResources={locationResources}
            allPhotos={allPhotos} navigate={navigate}
            handleBookResource={handleBookResource}
            galleryOpen={galleryOpen} setGalleryOpen={setGalleryOpen}
            galleryIndex={galleryIndex} setGalleryIndex={setGalleryIndex}
        />
    );

    return (
        <MinimalLayout>
            <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 py-6 sm:py-8">
                {/* Header */}
                <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="text-3xl sm:text-4xl font-black text-unbox-dark tracking-tight mb-1.5">{location.name}</h1>
                        <div className="flex items-center text-unbox-grey font-medium text-sm">
                            <MapPin className="w-4 h-4 mr-1.5 text-unbox-green flex-shrink-0" />
                            {location.address}
                        </div>
                    </div>
                    <button
                        onClick={() => navigate('/')}
                        className="text-sm font-bold text-unbox-green hover:text-unbox-dark bg-unbox-light px-4 py-2 rounded-full transition-colors"
                    >
                        Сменить локацию
                    </button>
                </div>

                {/* ── Hero Gallery — Airbnb-style mosaic ── */}
                <div className="mb-10 sm:mb-12">
                    {heroPhotos.length >= 3 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 rounded-2xl sm:rounded-3xl overflow-hidden">
                            {/* Large left photo */}
                            <div
                                className="sm:col-span-2 sm:row-span-2 relative cursor-pointer group"
                                onClick={() => openGallery(0)}
                            >
                                <div className="aspect-[4/3] sm:aspect-auto sm:h-full">
                                    <img src={heroPhotos[0]} alt="Main" className="w-full h-full object-cover transition-all duration-500 group-hover:brightness-95" />
                                </div>
                            </div>
                            {/* Right column — stacked photos */}
                            <div className="hidden sm:block relative cursor-pointer group" onClick={() => openGallery(1)}>
                                <div className="aspect-[4/3]">
                                    <img src={heroPhotos[1]} alt="Photo 2" className="w-full h-full object-cover transition-all duration-500 group-hover:brightness-95" />
                                </div>
                            </div>
                            <div className="hidden sm:block relative cursor-pointer group" onClick={() => openGallery(2)}>
                                <div className="aspect-[4/3]">
                                    <img src={heroPhotos[2]} alt="Photo 3" className="w-full h-full object-cover transition-all duration-500 group-hover:brightness-95" />
                                </div>
                            </div>
                            {heroPhotos[3] && (
                                <div className="hidden sm:block relative cursor-pointer group" onClick={() => openGallery(3)}>
                                    <div className="aspect-[4/3]">
                                        <img src={heroPhotos[3]} alt="Photo 4" className="w-full h-full object-cover transition-all duration-500 group-hover:brightness-95" />
                                    </div>
                                </div>
                            )}
                            {heroPhotos[4] ? (
                                <div className="hidden sm:block relative cursor-pointer group" onClick={() => openGallery(4)}>
                                    <div className="aspect-[4/3] relative">
                                        <img src={heroPhotos[4]} alt="Photo 5" className="w-full h-full object-cover transition-all duration-500 group-hover:brightness-95" />
                                        {allPhotos.length > 5 && (
                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center transition-all group-hover:bg-black/50">
                                                <span className="text-white text-sm font-bold">+{allPhotos.length - 5} фото</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : heroPhotos.length === 4 ? (
                                <div className="hidden sm:flex relative cursor-pointer items-center justify-center bg-unbox-light/60 hover:bg-unbox-light transition-colors" onClick={() => openGallery(0)}>
                                    <span className="text-sm font-semibold text-unbox-dark/50">Все фото</span>
                                </div>
                            ) : null}

                            {/* Mobile: show 2 small photos below */}
                            <div className="grid grid-cols-2 gap-2 sm:hidden">
                                <div className="aspect-[4/3] cursor-pointer" onClick={() => openGallery(1)}>
                                    <img src={heroPhotos[1]} alt="Photo 2" className="w-full h-full object-cover rounded-xl" />
                                </div>
                                <div className="aspect-[4/3] cursor-pointer relative" onClick={() => openGallery(2)}>
                                    <img src={heroPhotos[2]} alt="Photo 3" className="w-full h-full object-cover rounded-xl" />
                                    {allPhotos.length > 3 && (
                                        <div className="absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center">
                                            <span className="text-white text-xs font-bold">+{allPhotos.length - 3} фото</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : heroPhotos.length === 2 ? (
                        <div className="grid grid-cols-2 gap-2 rounded-2xl sm:rounded-3xl overflow-hidden">
                            {heroPhotos.map((photo, idx) => (
                                <div key={idx} className="aspect-[4/3] cursor-pointer group" onClick={() => openGallery(idx)}>
                                    <img src={photo} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover transition-all duration-500 group-hover:brightness-95" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-2xl sm:rounded-3xl overflow-hidden cursor-pointer group" onClick={() => openGallery(0)}>
                            <div className="aspect-[16/7]">
                                <img src={heroPhotos[0]} alt="Main" className="w-full h-full object-cover transition-all duration-500 group-hover:brightness-95" />
                            </div>
                        </div>
                    )}

                    {/* "Show all photos" button */}
                    {allPhotos.length > 3 && (
                        <div className="hidden sm:flex justify-end -mt-14 mr-4 relative z-10">
                            <button
                                onClick={() => openGallery(0)}
                                className="bg-white/95 backdrop-blur-sm hover:bg-white text-unbox-dark text-sm font-semibold px-4 py-2 rounded-xl shadow-lg border border-gray-200 transition-colors"
                            >
                                Все фото ({allPhotos.length})
                            </button>
                        </div>
                    )}
                </div>

                {/* ── About the location ── */}
                <div className="mb-10 sm:mb-12 grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2">
                        <h2 className="text-xl sm:text-2xl font-bold text-unbox-dark mb-4">О локации</h2>
                        {location.description ? (
                            <p className="text-gray-600 leading-relaxed text-[15px]">{location.description}</p>
                        ) : (
                            <p className="text-gray-500 leading-relaxed text-[15px]">
                                Уютное пространство для психологов, коучей и специалистов помогающих профессий.
                                Комфортные кабинеты с отличной звукоизоляцией и всем необходимым для продуктивной работы.
                            </p>
                        )}
                    </div>
                    {/* Quick info sidebar */}
                    <div className="space-y-3">
                        <div className="bg-white rounded-2xl border border-unbox-light/80 p-5 shadow-sm">
                            <div className="text-sm text-unbox-grey mb-1">Кабинетов</div>
                            <div className="text-2xl font-bold text-unbox-dark">{locationResources.length}</div>
                        </div>
                        {locationResources.length > 0 && (
                            <div className="bg-white rounded-2xl border border-unbox-light/80 p-5 shadow-sm">
                                <div className="text-sm text-unbox-grey mb-1">Цена от</div>
                                <div className="text-2xl font-bold text-unbox-green">
                                    {Math.min(...locationResources.map(r => r.hourlyRate || 0))} ₾/час
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Location Features */}
                {location.features && location.features.length > 0 && (
                    <div className="mb-10 sm:mb-12">
                        <h2 className="text-xl sm:text-2xl font-bold text-unbox-dark mb-5">Удобства локации</h2>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {location.features.map((feature, i) => {
                                let Icon = Coffee;
                                if (feature.toLowerCase().includes('wifi') || feature.toLowerCase().includes('интернет')) Icon = Wifi;
                                if (feature.toLowerCase().includes('переговор')) Icon = Users;
                                if (feature.toLowerCase().includes('охран') || feature.toLowerCase().includes('доступ')) Icon = Shield;
                                if (feature.toLowerCase().includes('парковк')) Icon = MapPin;
                                return (
                                    <div key={i} className="flex items-center gap-3 bg-white p-4 rounded-2xl border border-unbox-light/80 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                                        <div className="bg-unbox-green/10 p-2.5 rounded-xl text-unbox-green flex-shrink-0">
                                            <Icon className="w-5 h-5" />
                                        </div>
                                        <span className="font-medium text-unbox-dark text-sm leading-tight">{feature}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ── Cabinet Cards ── */}
                {locationResources.length > 0 && (
                    <div className="mb-16">
                        <div className="flex items-end justify-between mb-6">
                            <div>
                                <h2 className="text-xl sm:text-2xl font-bold text-unbox-dark">Кабинеты и пространства</h2>
                                <p className="text-unbox-grey text-sm mt-1">
                                    Выберите кабинет для бронирования
                                </p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
                            {locationResources.map(resource => {
                                const coverPhoto = resource.photos?.[0];
                                const resourceServices = (resource.services || [])
                                    .map(sid => CABINET_SERVICES.find(s => s.id === sid))
                                    .filter(Boolean);
                                return (
                                    <div
                                        key={resource.id}
                                        className="group bg-white rounded-2xl sm:rounded-3xl overflow-hidden border border-unbox-light shadow-sm hover:shadow-xl hover:border-unbox-green/30 transition-all duration-300 flex flex-col"
                                    >
                                        {/* Photo */}
                                        <div className="relative aspect-[16/10] bg-gradient-to-br from-unbox-light to-gray-100 overflow-hidden">
                                            {coverPhoto ? (
                                                <img src={coverPhoto} alt={resource.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-unbox-light to-gray-100">
                                                    <svg className="w-12 h-12 text-unbox-green/25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path d="M9 22V12h6v10"/></svg>
                                                </div>
                                            )}
                                            <div className="absolute top-3 left-3">
                                                <span className={clsx('px-2.5 py-1 rounded-full text-xs font-bold uppercase backdrop-blur-sm', resource.type === 'capsule' ? 'bg-purple-500/90 text-white' : 'bg-white/90 text-unbox-green')}>
                                                    {resource.type === 'capsule' ? 'Капсула' : 'Кабинет'}
                                                </span>
                                            </div>
                                            <div className="absolute bottom-3 right-3">
                                                <span className="bg-unbox-dark/80 backdrop-blur-sm text-white px-3 py-1.5 rounded-full text-sm font-bold">
                                                    {resource.hourlyRate} ₾/час
                                                </span>
                                            </div>
                                        </div>

                                        {/* Info */}
                                        <div className="p-5 flex flex-col gap-3 flex-1">
                                            <div>
                                                <h3 className="text-lg font-bold text-unbox-dark">{resource.name}</h3>
                                                <div className="flex items-center gap-3 mt-1.5 text-sm text-unbox-grey">
                                                    <span className="flex items-center gap-1"><Users size={13} /> до {resource.capacity} чел.</span>
                                                    {resource.area && <span className="flex items-center gap-1"><Ruler size={13} /> {resource.area} м²</span>}
                                                </div>
                                            </div>
                                            {resource.description && (
                                                <p className="text-sm text-gray-500 leading-relaxed line-clamp-2">{resource.description}</p>
                                            )}
                                            {resourceServices.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {resourceServices.slice(0, 4).map(svc => svc && (
                                                        <span key={svc.id} className="inline-flex items-center gap-1 px-2.5 py-1 bg-unbox-light/70 rounded-full text-xs text-gray-600 border border-unbox-light">
                                                            <span>{svc.emoji}</span><span>{svc.label}</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Book button */}
                                            <button
                                                onClick={() => handleBookResource(resource.id)}
                                                className="mt-auto w-full py-3 rounded-2xl font-semibold text-sm bg-unbox-green text-white hover:bg-unbox-dark active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 shadow-md shadow-unbox-green/20"
                                            >
                                                Забронировать <ArrowRight size={16} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Fullscreen Gallery Modal ── */}
            {galleryOpen && (
                <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={() => setGalleryOpen(false)}>
                    {/* Top bar */}
                    <div className="flex items-center justify-between px-4 sm:px-6 py-4 text-white">
                        <span className="text-sm font-medium">{galleryIndex + 1} / {allPhotos.length}</span>
                        <button onClick={() => setGalleryOpen(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                            <X size={24} />
                        </button>
                    </div>

                    {/* Main photo */}
                    <div className="flex-1 flex items-center justify-center px-4 sm:px-16 relative" onClick={e => e.stopPropagation()}>
                        <img
                            src={allPhotos[galleryIndex]}
                            alt={`Photo ${galleryIndex + 1}`}
                            className="max-w-full max-h-[80vh] object-contain rounded-lg"
                        />

                        {/* Navigation arrows */}
                        {galleryIndex > 0 && (
                            <button
                                onClick={() => setGalleryIndex(i => i - 1)}
                                className="absolute left-2 sm:left-6 p-2 sm:p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                            >
                                <ChevronLeft size={24} />
                            </button>
                        )}
                        {galleryIndex < allPhotos.length - 1 && (
                            <button
                                onClick={() => setGalleryIndex(i => i + 1)}
                                className="absolute right-2 sm:right-6 p-2 sm:p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                            >
                                <ChevronRight size={24} />
                            </button>
                        )}
                    </div>

                    {/* Thumbnails */}
                    {allPhotos.length > 1 && (
                        <div className="px-4 sm:px-6 py-4 flex gap-2 justify-center overflow-x-auto" onClick={e => e.stopPropagation()}>
                            {allPhotos.map((photo, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setGalleryIndex(idx)}
                                    className={clsx(
                                        'w-16 h-12 sm:w-20 sm:h-14 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-all',
                                        idx === galleryIndex ? 'border-white opacity-100' : 'border-transparent opacity-50 hover:opacity-80'
                                    )}
                                >
                                    <img src={photo} alt="" className="w-full h-full object-cover" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </MinimalLayout>
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
    location, locationResources, allPhotos, navigate: _navigate, handleBookResource,
    galleryOpen, setGalleryOpen, galleryIndex, setGalleryIndex,
}: GridHouseLocationDetailsProps) {
    return (
        <MinimalLayout>
            <div style={{ fontFamily: GH_SANS, color: GH.ink, maxWidth: 1200, margin: '0 auto', padding: '32px 24px 80px' }}>
                {/* Header */}
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
                                <div key={resource.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 16, alignItems: 'center', padding: '16px 20px', borderBottom: i < locationResources.length - 1 ? ghldHairline : 'none' }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: 15 }}>{resource.name}</div>
                                        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
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
                                    <div style={{ fontFamily: GH_MONO, fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap' }}>
                                        {resource.hourlyRate} ₾/час
                                    </div>
                                    <button
                                        onClick={() => handleBookResource(resource.id)}
                                        style={{
                                            padding: '8px 20px', background: GH.ink, color: GH.paper,
                                            fontWeight: 700, fontSize: 12, fontFamily: GH_SANS, border: 'none', cursor: 'pointer',
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
        </MinimalLayout>
    );
}
