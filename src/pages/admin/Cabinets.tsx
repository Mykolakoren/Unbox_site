import { useState, useEffect } from 'react';
import { LOCATIONS, CABINET_SERVICES } from '../../utils/data';
import { useBookingStore } from '../../store/bookingStore';
import { MapPin, Users, Ruler, Settings, ImageOff } from 'lucide-react';
import clsx from 'clsx';
import { ResourceModal } from '../../components/admin/ResourceModal';
import type { Resource } from '../../types';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

/* ── Grid House module-scope constants (prefix: ghc) ── */
const ghcHairline = `1px solid ${GH.ink10}`;
const ghcMono: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: GH.ink60,
};
const ghcH1: React.CSSProperties = {
    fontFamily: GH_SANS,
    fontWeight: 800,
    fontSize: 'clamp(28px, 3.5vw, 42px)',
    lineHeight: 0.95,
    letterSpacing: '-0.02em',
    margin: 0,
};

export function AdminCabinets() {
    const gridHouse = useDesignFlag();
    const { resources, fetchResources } = useBookingStore();
    const [filterLocation, setFilterLocation] = useState<string | 'all'>('all');

    // Edit State
    const [editingResource, setEditingResource] = useState<Resource | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        fetchResources();
    }, [fetchResources]);

    const filteredResources = filterLocation === 'all'
        ? resources
        : resources.filter(r => r.locationId === filterLocation);

    const handleEdit = (resource: Resource) => {
        setEditingResource(resource);
        setIsModalOpen(true);
    };

    if (gridHouse) return (
        <GridHouseCabinets
            filteredResources={filteredResources}
            filterLocation={filterLocation}
            setFilterLocation={setFilterLocation}
            handleEdit={handleEdit}
            editingResource={editingResource}
            isModalOpen={isModalOpen}
            setIsModalOpen={setIsModalOpen}
        />
    );

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-wrap justify-between items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Кабинеты</h1>
                    <p className="text-unbox-grey">Управление пространствами и ресурсами</p>
                </div>

                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setFilterLocation('all')}
                        className={clsx(
                            "px-4 py-2 rounded-xl text-sm font-medium transition-colors",
                            filterLocation === 'all' ? "bg-unbox-green text-white" : "bg-white text-unbox-grey hover:bg-unbox-light/30"
                        )}
                    >
                        Все
                    </button>
                    {LOCATIONS.map(loc => (
                        <button
                            key={loc.id}
                            onClick={() => setFilterLocation(loc.id)}
                            className={clsx(
                                "px-4 py-2 rounded-xl text-sm font-medium transition-colors",
                                filterLocation === loc.id ? "bg-unbox-green text-white" : "bg-white text-unbox-grey hover:bg-unbox-light/30"
                            )}
                        >
                            {loc.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredResources.map(resource => {
                    const coverPhoto = resource.photos?.[0];
                    const locationName = LOCATIONS.find(l => l.id === resource.locationId)?.name;
                    const resourceServices = (resource.services || [])
                        .map(id => CABINET_SERVICES.find(s => s.id === id))
                        .filter(Boolean)
                        .slice(0, 4);

                    return (
                        <div
                            key={resource.id}
                            className="bg-white/80 backdrop-blur-sm rounded-2xl overflow-hidden border border-white/70 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col"
                        >
                            {/* Photo / Placeholder */}
                            <div className="relative h-44 bg-gradient-to-br from-unbox-light to-gray-100 overflow-hidden">
                                {coverPhoto ? (
                                    <img
                                        src={coverPhoto}
                                        alt={resource.name}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 gap-2">
                                        <ImageOff size={32} />
                                        <span className="text-xs">Нет фото</span>
                                    </div>
                                )}

                                {/* Overlay badges */}
                                <div className="absolute top-3 left-3 flex gap-1.5">
                                    <span className={clsx(
                                        "px-2.5 py-1 rounded-full text-[11px] font-bold uppercase backdrop-blur-sm",
                                        resource.type === 'cabinet'
                                            ? "bg-white/90 text-unbox-green"
                                            : "bg-purple-500/90 text-white"
                                    )}>
                                        {resource.type === 'cabinet' ? 'Кабинет' : 'Капсула'}
                                    </span>
                                    {resource.isActive === false && (
                                        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase bg-gray-800/80 text-white backdrop-blur-sm">
                                            Скрыт
                                        </span>
                                    )}
                                </div>

                                {resource.photos && resource.photos.length > 1 && (
                                    <span className="absolute bottom-2 right-2 text-[10px] bg-black/50 text-white px-2 py-0.5 rounded-full backdrop-blur-sm">
                                        +{resource.photos.length - 1} фото
                                    </span>
                                )}
                            </div>

                            {/* Content */}
                            <div className="p-4 flex flex-col gap-3 flex-1">
                                {/* Name + Location */}
                                <div>
                                    <h3 className="font-bold text-base">{resource.name}</h3>
                                    {locationName && (
                                        <div className="flex items-center text-xs text-unbox-grey mt-0.5 gap-1">
                                            <MapPin size={11} />
                                            {locationName}
                                        </div>
                                    )}
                                </div>

                                {/* Description */}
                                {resource.description && (
                                    <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
                                        {resource.description}
                                    </p>
                                )}

                                {/* Services chips */}
                                {resourceServices.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {resourceServices.map(svc => svc && (
                                            <span
                                                key={svc.id}
                                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-unbox-light/60 rounded-full text-[11px] text-gray-600"
                                                title={svc.label}
                                            >
                                                <span>{svc.emoji}</span>
                                                <span>{svc.label}</span>
                                            </span>
                                        ))}
                                        {(resource.services || []).length > 4 && (
                                            <span className="px-2 py-0.5 bg-unbox-light/60 rounded-full text-[11px] text-unbox-grey">
                                                +{(resource.services || []).length - 4}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Stats + Action */}
                                <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-auto">
                                    <div className="flex items-center gap-3 text-xs text-unbox-grey">
                                        <span className="flex items-center gap-1">
                                            <Users size={12} /> {resource.capacity} чел.
                                        </span>
                                        {resource.area && (
                                            <span className="flex items-center gap-1">
                                                <Ruler size={12} /> {resource.area} м²
                                            </span>
                                        )}
                                        <span className="font-semibold text-unbox-dark">{resource.hourlyRate} ₾/ч</span>
                                    </div>
                                    <button
                                        onClick={() => handleEdit(resource)}
                                        className="flex items-center gap-1.5 text-xs font-medium text-unbox-grey hover:text-unbox-green transition-colors px-3 py-1.5 rounded-lg hover:bg-unbox-light/50"
                                    >
                                        <Settings size={13} /> Настройки
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <ResourceModal
                resource={editingResource}
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
            />
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Grid House variant — Cabinets
   ═══════════════════════════════════════════════════════════════ */

interface GridHouseCabinetsProps {
    filteredResources: Resource[];
    filterLocation: string;
    setFilterLocation: (v: string) => void;
    handleEdit: (r: Resource) => void;
    editingResource: Resource | null;
    isModalOpen: boolean;
    setIsModalOpen: (v: boolean) => void;
}

function GridHouseCabinets({
    filteredResources,
    filterLocation,
    setFilterLocation,
    handleEdit,
    editingResource,
    isModalOpen,
    setIsModalOpen,
}: GridHouseCabinetsProps) {
    const total = String(filteredResources.length).padStart(3, '0');
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 768);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            {/* ── Header ── */}
            <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: narrow ? 16 : 28, marginBottom: narrow ? 16 : 28 }}>
                <div style={{ ...ghcMono, marginBottom: narrow ? 8 : 14 }}>Раздел · Кабинеты</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: narrow ? 12 : 24, flexWrap: 'wrap' }}>
                    <h1 style={{ ...ghcH1, fontSize: narrow ? 24 : ghcH1.fontSize }}>Каталог пространств.</h1>
                    <div style={{ fontFamily: GH_MONO, fontSize: narrow ? 36 : 'clamp(40px, 5vw, 64px)', fontWeight: 700, lineHeight: 0.9, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                        {total}
                    </div>
                </div>
                <div style={{ ...ghcMono, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
                    Показано кабинетов
                </div>
            </div>

            {/* ── Location filter tabs ── */}
            <div style={{
                borderTop: `2px solid ${GH.ink}`,
                borderBottom: ghcHairline,
                display: 'flex',
                gap: 0,
                marginBottom: narrow ? 20 : 32,
                overflowX: narrow ? 'auto' : 'visible',
                flexWrap: narrow ? 'nowrap' : 'wrap',
                WebkitOverflowScrolling: 'touch',
            }}>
                {[{ id: 'all', name: narrow ? 'Все' : 'Все филиалы' }, ...LOCATIONS].map((loc) => {
                    const active = filterLocation === loc.id;
                    return (
                        <button
                            key={loc.id}
                            onClick={() => setFilterLocation(loc.id)}
                            style={{
                                fontFamily: GH_MONO,
                                fontSize: narrow ? 10 : 11,
                                fontWeight: 600,
                                letterSpacing: '0.14em',
                                textTransform: 'uppercase' as const,
                                padding: narrow ? '12px 14px' : '18px 24px',
                                background: active ? GH.ink : 'transparent',
                                color: active ? GH.paper : GH.ink,
                                border: 'none',
                                borderRight: `1px solid ${GH.ink10}`,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap' as const,
                                flexShrink: 0,
                            }}
                        >
                            {loc.name}
                        </button>
                    );
                })}
            </div>

            {/* ── Grid / Empty state ── */}
            {filteredResources.length === 0 ? (
                <div style={{ borderTop: `2px solid ${GH.ink}`, borderBottom: ghcHairline, padding: '80px 24px', textAlign: 'center' }}>
                    <div style={{ ...ghcMono, marginBottom: 14 }}>→ Пусто</div>
                    <h2 style={{ ...ghcH1, fontSize: 'clamp(28px, 3.5vw, 44px)' }}>Нет кабинетов.</h2>
                </div>
            ) : (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: narrow ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: 0,
                        borderTop: `2px solid ${GH.ink}`,
                        borderLeft: narrow ? undefined : `1px solid ${GH.ink10}`,
                    }}
                >
                    {filteredResources.map((resource, idx) => {
                        const coverPhoto = resource.photos?.[0];
                        const locationName = LOCATIONS.find((l) => l.id === resource.locationId)?.name;
                        const resourceServices = (resource.services || [])
                            .map((id) => CABINET_SERVICES.find((s) => s.id === id))
                            .filter(Boolean)
                            .slice(0, 3);

                        return (
                            <div
                                key={resource.id}
                                style={{
                                    borderBottom: `1px solid ${GH.ink10}`,
                                    borderRight: `1px solid ${GH.ink10}`,
                                    background: GH.paper,
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}
                            >
                                {/* Photo / number frame */}
                                <div style={{ borderBottom: ghcHairline, background: GH.paper, aspectRatio: '16 / 10', overflow: 'hidden', position: 'relative' }}>
                                    {coverPhoto ? (
                                        <img src={coverPhoto} alt={resource.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                    ) : (
                                        <>
                                            <div
                                                style={{
                                                    position: 'absolute',
                                                    inset: 0,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontFamily: GH_SANS,
                                                    fontWeight: 800,
                                                    fontSize: 'clamp(80px, 14vw, 140px)',
                                                    lineHeight: 0.8,
                                                    letterSpacing: '-0.04em',
                                                    color: GH.ink,
                                                    fontVariantNumeric: 'tabular-nums',
                                                    userSelect: 'none',
                                                }}
                                            >
                                                {String(idx + 1).padStart(2, '0')}
                                            </div>
                                            <div style={{ position: 'absolute', top: 10, left: 12, ...ghcMono, color: GH.ink30, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <ImageOff size={10} /> Без фото
                                            </div>
                                        </>
                                    )}

                                    {/* Top badges */}
                                    <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', gap: 4 }}>
                                        <span
                                            style={{
                                                fontFamily: GH_MONO,
                                                fontSize: 10,
                                                letterSpacing: '0.14em',
                                                textTransform: 'uppercase',
                                                color: GH.paper,
                                                background: GH.ink,
                                                padding: '3px 8px',
                                            }}
                                        >
                                            {resource.type === 'cabinet' ? 'Кабинет' : 'Капсула'}
                                        </span>
                                        {resource.isActive === false && (
                                            <span
                                                style={{
                                                    fontFamily: GH_MONO,
                                                    fontSize: 10,
                                                    letterSpacing: '0.14em',
                                                    textTransform: 'uppercase',
                                                    color: GH.paper,
                                                    background: GH.danger,
                                                    padding: '3px 8px',
                                                }}
                                            >
                                                Скрыт
                                            </span>
                                        )}
                                    </div>

                                    {resource.photos && resource.photos.length > 1 && (
                                        <div style={{ position: 'absolute', bottom: 10, right: 12, ...ghcMono, color: GH.ink60, background: GH.paper, padding: '2px 6px' }}>
                                            +{resource.photos.length - 1}
                                        </div>
                                    )}
                                </div>

                                {/* Body */}
                                <div style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
                                    <div>
                                        <div style={{ ...ghcMono, fontVariantNumeric: 'tabular-nums', marginBottom: 6 }}>
                                            {String(idx + 1).padStart(3, '0')}
                                        </div>
                                        <div
                                            style={{
                                                fontFamily: GH_SANS,
                                                fontWeight: 700,
                                                fontSize: 20,
                                                letterSpacing: '-0.015em',
                                                lineHeight: 1.15,
                                                color: GH.ink,
                                            }}
                                        >
                                            {resource.name}
                                        </div>
                                        {locationName && (
                                            <div style={{ ...ghcMono, color: GH.ink60, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <MapPin size={10} /> {locationName}
                                            </div>
                                        )}
                                    </div>

                                    {resource.description && (
                                        <div
                                            style={{
                                                fontFamily: GH_SANS,
                                                fontSize: 13,
                                                lineHeight: 1.5,
                                                color: GH.ink60,
                                                display: '-webkit-box',
                                                WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical',
                                                overflow: 'hidden',
                                            }}
                                        >
                                            {resource.description}
                                        </div>
                                    )}

                                    {resourceServices.length > 0 && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                            {resourceServices.map(
                                                (svc) =>
                                                    svc && (
                                                        <span
                                                            key={svc.id}
                                                            title={svc.label}
                                                            style={{
                                                                fontFamily: GH_MONO,
                                                                fontSize: 10,
                                                                letterSpacing: '0.08em',
                                                                textTransform: 'uppercase',
                                                                padding: '3px 7px',
                                                                color: GH.ink,
                                                                border: `1px solid ${GH.ink10}`,
                                                            }}
                                                        >
                                                            {svc.label}
                                                        </span>
                                                    )
                                            )}
                                            {(resource.services || []).length > 3 && (
                                                <span style={{ ...ghcMono, padding: '3px 7px' }}>
                                                    +{(resource.services || []).length - 3}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Card footer stats */}
                                    <div
                                        style={{
                                            marginTop: 'auto',
                                            paddingTop: 14,
                                            borderTop: ghcHairline,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: 8,
                                        }}
                                    >
                                        <div style={{ display: 'flex', gap: 10, ...ghcMono, color: GH.ink, fontVariantNumeric: 'tabular-nums' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                <Users size={11} /> {resource.capacity}
                                            </span>
                                            {resource.area && (
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                    <Ruler size={11} /> {resource.area}м²
                                                </span>
                                            )}
                                            <span style={{ color: GH.ink, fontWeight: 700 }}>
                                                {resource.hourlyRate}₾/ч
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => handleEdit(resource)}
                                            style={{
                                                fontFamily: GH_MONO,
                                                fontSize: 10,
                                                fontWeight: 600,
                                                letterSpacing: '0.14em',
                                                textTransform: 'uppercase',
                                                padding: '6px 10px',
                                                background: 'transparent',
                                                color: GH.ink,
                                                border: `1px solid ${GH.ink}`,
                                                cursor: 'pointer',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 5,
                                            }}
                                        >
                                            <Settings size={11} /> Править
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Footer ── */}
            <div style={{ borderTop: `2px solid ${GH.ink}`, marginTop: 40, padding: '18px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ ...ghcMono, color: GH.ink30 }}>UNBOX ADMIN · 2026</div>
                <div style={{ ...ghcMono, color: GH.ink30, fontVariantNumeric: 'tabular-nums' }}>
                    {total} кабинетов
                </div>
            </div>

            <ResourceModal resource={editingResource} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        </div>
    );
}
