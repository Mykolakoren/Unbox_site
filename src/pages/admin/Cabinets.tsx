import { useState, useEffect } from 'react';
import { LOCATIONS, CABINET_SERVICES } from '../../utils/data';
import { useBookingStore } from '../../store/bookingStore';
import { MapPin, Users, Ruler, Settings, ImageOff, Power, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ResourceModal } from '../../components/admin/ResourceModal';
import { resourcesApi } from '../../api/resources';
import { locationsApi } from '../../api/locations';
import type { Resource, Location } from '../../types';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

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
    const { resources, fetchResources, locations, fetchLocations } = useBookingStore();
    const [filterLocation, setFilterLocation] = useState<string | 'all'>('all');
    const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);

    // Edit State
    const [editingResource, setEditingResource] = useState<Resource | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        fetchResources();
        fetchLocations();
    }, [fetchResources, fetchLocations]);

    const filteredResources = filterLocation === 'all'
        ? resources
        : resources.filter(r => r.locationId === filterLocation);

    const handleEdit = (resource: Resource) => {
        setEditingResource(resource);
        setIsModalOpen(true);
    };

    const handleToggleResource = async (r: Resource) => {
        const next = !(r.isActive !== false);
        setToggleBusyId(r.id);
        try {
            await resourcesApi.update(r.id, { isActive: next });
            await fetchResources();
            toast.success(next ? 'Кабинет включён' : 'Кабинет скрыт');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось');
        } finally {
            setToggleBusyId(null);
        }
    };

    // Owner 2026-05-27: toggling a location off also disables every cabinet
    // inside it — that way the existing cabinet-isActive filter in the
    // booking flow does the right thing without a separate location check
    // in every place. Re-enabling a location does NOT auto-enable its
    // cabinets — admins flip them back individually as needed (avoids
    // unexpected unhide of a cabinet that was off for its own reason).
    const handleToggleLocation = async (loc: Location) => {
        const next = !(loc.isActive !== false);
        const action = next ? 'включить' : 'выключить';
        const childrenAffected = resources.filter(r => r.locationId === loc.id);
        if (!confirm(
            `${next ? 'Включить' : 'Выключить'} локацию "${loc.name}"?\n\n`
            + (next
                ? 'Кабинеты внутри останутся в своём текущем состоянии (включи нужные вручную).'
                : `Все ${childrenAffected.length} кабинета в этой локации станут скрытыми.`),
        )) return;
        setToggleBusyId(loc.id);
        try {
            await locationsApi.update(loc.id, { isActive: next });
            if (!next) {
                // Cascade: disable every cabinet in this location.
                for (const child of childrenAffected) {
                    if (child.isActive !== false) {
                        await resourcesApi.update(child.id, { isActive: false });
                    }
                }
            }
            await fetchLocations();
            await fetchResources();
            toast.success(next ? 'Локация включена' : 'Локация и её кабинеты скрыты');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || `Не удалось ${action}`);
        } finally {
            setToggleBusyId(null);
        }
    };

    return (

        <GridHouseCabinets
            filteredResources={filteredResources}
            filterLocation={filterLocation}
            setFilterLocation={setFilterLocation}
            handleEdit={handleEdit}
            editingResource={editingResource}
            isModalOpen={isModalOpen}
            setIsModalOpen={setIsModalOpen}
            locations={locations.length > 0 ? locations : LOCATIONS}
            onToggleResource={handleToggleResource}
            onToggleLocation={handleToggleLocation}
            toggleBusyId={toggleBusyId}
            resources={resources}
        />
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
    locations: Location[];
    onToggleResource: (r: Resource) => void;
    onToggleLocation: (l: Location) => void;
    toggleBusyId: string | null;
    resources: Resource[];
}

function GridHouseCabinets({
    filteredResources,
    filterLocation,
    setFilterLocation,
    handleEdit,
    editingResource,
    isModalOpen,
    setIsModalOpen,
    locations,
    onToggleResource,
    onToggleLocation,
    toggleBusyId,
    resources,
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

            {/* ── Locations management strip ──
                Owner 2026-05-27: above the cabinet grid, list every location
                with an on/off toggle. Switching a location off cascades
                disable to every cabinet inside it (the booking UI honours
                cabinet.isActive). Re-enabling a location does NOT auto-
                re-enable cabinets — admins flip the ones they want back. */}
            <div style={{ marginBottom: narrow ? 20 : 32, paddingBottom: narrow ? 16 : 24, borderBottom: ghcHairline }}>
                <div style={{ ...ghcMono, marginBottom: 12 }}>Раздел · Локации</div>
                <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                    {locations.map(loc => {
                        const childCount = resources.filter(r => r.locationId === loc.id).length;
                        const childActive = resources.filter(r => r.locationId === loc.id && r.isActive !== false).length;
                        const isActive = loc.isActive !== false;
                        const busy = toggleBusyId === loc.id;
                        return (
                            <div
                                key={loc.id}
                                style={{
                                    border: ghcHairline,
                                    padding: '14px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    opacity: isActive ? 1 : 0.6,
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontFamily: GH_SANS, fontWeight: 700, fontSize: 15, color: GH.ink }}>
                                        {loc.name}
                                        {!isActive && (
                                            <span style={{
                                                fontFamily: GH_MONO,
                                                fontSize: 9,
                                                letterSpacing: '0.14em',
                                                textTransform: 'uppercase',
                                                color: GH.paper,
                                                background: GH.danger,
                                                padding: '2px 6px',
                                                marginLeft: 8,
                                                verticalAlign: 'middle',
                                            }}>
                                                Скрыта
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ ...ghcMono, marginTop: 4 }}>
                                        {childActive} / {childCount} активных кабинетов
                                    </div>
                                </div>
                                <button
                                    onClick={() => onToggleLocation(loc)}
                                    disabled={busy}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '8px 14px',
                                        background: isActive ? GH.ink5 : GH.danger,
                                        color: isActive ? GH.ink : GH.paper,
                                        border: 'none',
                                        fontFamily: GH_MONO,
                                        fontSize: 10,
                                        fontWeight: 700,
                                        letterSpacing: '0.14em',
                                        textTransform: 'uppercase',
                                        cursor: busy ? 'wait' : 'pointer',
                                        opacity: busy ? 0.6 : 1,
                                    }}
                                    title={isActive
                                        ? 'Скрыть локацию и все её кабинеты'
                                        : 'Показать локацию (кабинеты включай вручную)'}
                                >
                                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                                    {isActive ? 'Вкл' : 'Выкл'}
                                </button>
                            </div>
                        );
                    })}
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
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <button
                                                onClick={() => onToggleResource(resource)}
                                                disabled={toggleBusyId === resource.id}
                                                style={{
                                                    fontFamily: GH_MONO,
                                                    fontSize: 10,
                                                    fontWeight: 600,
                                                    letterSpacing: '0.14em',
                                                    textTransform: 'uppercase',
                                                    padding: '6px 10px',
                                                    background: resource.isActive === false ? GH.danger : GH.ink5,
                                                    color: resource.isActive === false ? GH.paper : GH.ink,
                                                    border: 'none',
                                                    cursor: toggleBusyId === resource.id ? 'wait' : 'pointer',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 5,
                                                    opacity: toggleBusyId === resource.id ? 0.6 : 1,
                                                }}
                                                title={resource.isActive === false
                                                    ? 'Показать кабинет'
                                                    : 'Скрыть кабинет от клиентов'}
                                            >
                                                {toggleBusyId === resource.id
                                                    ? <Loader2 size={11} className="animate-spin" />
                                                    : <Power size={11} />}
                                                {resource.isActive === false ? 'Выкл' : 'Вкл'}
                                            </button>
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
