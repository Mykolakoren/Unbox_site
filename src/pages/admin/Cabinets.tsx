import { useState, useEffect } from 'react';
import { CABINET_SERVICES } from '../../utils/data';
import { useBookingStore } from '../../store/bookingStore';
import { MapPin, Users, Ruler, Settings, ImageOff, Power, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ResourceModal } from '../../components/admin/ResourceModal';
import { resourcesApi } from '../../api/resources';
import { locationsApi } from '../../api/locations';
import type { Resource, Location } from '../../types';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { undoToast } from '../../components/ui/undoToast';
import { ruCountWord } from '../../utils/plural';
import { STATUS } from '../../design/tokens';
import { formatGel } from '../../utils/format';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';

/* ── Grid House module-scope constants (prefix: ghc) ── */
const ghcHairline = `1px solid ${GH.ink10}`;
const ghcMono: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: GH.ink60,
};

export function AdminCabinets() {
    const { resources, fetchResources, locations, fetchLocations } = useBookingStore();
    const [filterLocation, setFilterLocation] = useState<string | 'all'>('all');
    const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);
    const { confirm } = useConfirmDialog();

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
            if (next) {
                toast.success('Кабинет снова виден клиентам');
            } else {
                // Аудит G8-05: скрыть — один клик, поэтому 5 секунд на «Вернуть».
                undoToast('Кабинет скрыт от клиентов', async () => {
                    try {
                        await resourcesApi.update(r.id, { isActive: true });
                        await fetchResources();
                    } catch (e: any) {
                        toast.error(e?.response?.data?.detail || 'Не удалось вернуть кабинет');
                    }
                });
            }
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
        const ok = await confirm(next
            ? {
                title: `Показать локацию «${loc.name}»?`,
                body: 'Кабинеты внутри останутся как есть — нужные включите вручную.',
                confirmLabel: 'Показать локацию',
                cancelLabel: 'Оставить скрытой',
            }
            : {
                title: `Скрыть локацию «${loc.name}»?`,
                body: `Клиенты перестанут её видеть, и все ${ruCountWord(childrenAffected.length, ['кабинет', 'кабинета', 'кабинетов'])} в ней тоже скроются.`,
                confirmLabel: 'Скрыть локацию',
                cancelLabel: 'Оставить',
                tone: 'danger',
            });
        if (!ok) return;
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
            locations={locations}
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
    const hiddenCount = filteredResources.filter(r => r.isActive === false).length;
    // Вкладки — из живого списка локаций (G8-16): раньше статичный LOCATIONS
    // давал пустую вкладку «Neo School», которой нет среди локаций выше.
    const tabs = [{ id: 'all', name: 'Все филиалы' }, ...locations.map(l => ({ id: l.id, name: l.name }))];
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 768);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            {/* ── Header: H1 = пункт меню, без «009» (G8-11) ── */}
            <PageHeader
                title="Кабинеты"
                description={`${ruCountWord(filteredResources.length, ['кабинет', 'кабинета', 'кабинетов'])}${hiddenCount > 0 ? ` · скрыто от клиентов: ${hiddenCount}` : ''}`}
            />

            {/* ── Locations management strip ──
                Owner 2026-05-27: above the cabinet grid, list every location
                with an on/off toggle. Switching a location off cascades
                disable to every cabinet inside it (the booking UI honours
                cabinet.isActive). Re-enabling a location does NOT auto-
                re-enable cabinets — admins flip the ones they want back. */}
            <div style={{ marginBottom: narrow ? 20 : 32, paddingBottom: narrow ? 16 : 24, borderBottom: ghcHairline }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>Локации</h2>
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
                                    <div style={{ fontFamily: GH_SANS, fontWeight: 600, fontSize: 16, color: GH.ink }}>
                                        {loc.name}
                                        {!isActive && (
                                            <span style={{
                                                fontFamily: GH_MONO,
                                                fontSize: 12,
                                                letterSpacing: '0.06em',
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
                                        видно клиентам {childActive} из {childCount}
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
                                        background: isActive ? GH.ink5 : GH.ink,
                                        color: isActive ? GH.ink : GH.paper,
                                        border: 'none',
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        fontWeight: 700,
                                        letterSpacing: '0.06em',
                                        textTransform: 'uppercase',
                                        cursor: busy ? 'wait' : 'pointer',
                                        opacity: busy ? 0.6 : 1,
                                    }}
                                    title={isActive
                                        ? 'Скрыть локацию и все её кабинеты'
                                        : 'Показать локацию (кабинеты включите вручную)'}
                                >
                                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                                    {isActive ? 'Скрыть' : 'Показать'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Location filter tabs ── */}
            <div role="group" aria-label="Филиал" style={{
                borderTop: `2px solid ${GH.ink}`,
                borderBottom: ghcHairline,
                display: 'flex',
                gap: 0,
                marginBottom: narrow ? 20 : 32,
                overflowX: narrow ? 'auto' : 'visible',
                flexWrap: narrow ? 'nowrap' : 'wrap',
                WebkitOverflowScrolling: 'touch',
            }}>
                {tabs.map((loc) => {
                    const active = filterLocation === loc.id;
                    return (
                        <button
                            key={loc.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setFilterLocation(loc.id)}
                            style={{
                                fontFamily: GH_MONO,
                                fontSize: 12,
                                fontWeight: 600,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase' as const,
                                padding: narrow ? '12px 14px' : '14px 24px',
                                background: active ? GH.ink : 'transparent',
                                color: active ? GH.paper : GH.ink,
                                border: 'none',
                                borderRight: `1px solid ${GH.ink10}`,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap' as const,
                                flexShrink: 0,
                            }}
                        >
                            {loc.id === 'all' && narrow ? 'Все' : loc.name}
                        </button>
                    );
                })}
            </div>

            {/* ── Grid / Empty state ── */}
            {filteredResources.length === 0 ? (
                <div style={{ border: ghcHairline, background: GH.card }}>
                    <EmptyState compact title="В этом филиале кабинетов нет" hint="Выберите другой филиал или «Все филиалы»." />
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
                    {filteredResources.map((resource) => {
                        const coverPhoto = resource.photos?.[0];
                        const locationName = locations.find((l) => l.id === resource.locationId)?.name;
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
                                        // Нейтральная заглушка: без порядкового номера — у «Кабинета 9»
                                        // раньше крупно стояло «07» (G8-16).
                                        <div
                                            style={{
                                                position: 'absolute', inset: 0, background: GH.sunken,
                                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                                                color: GH.ink60, fontSize: 14,
                                            }}
                                        >
                                            <ImageOff size={24} aria-hidden="true" />
                                            Фото пока нет
                                        </div>
                                    )}

                                    {/* Top badges */}
                                    <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', gap: 4 }}>
                                        <span
                                            style={{
                                                fontFamily: GH_MONO,
                                                fontSize: 12,
                                                letterSpacing: '0.06em',
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
                                                    fontSize: 12,
                                                    letterSpacing: '0.06em',
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
                                        <div
                                            style={{
                                                fontFamily: GH_SANS,
                                                fontWeight: 600,
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
                                                fontSize: 14,
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
                                                                fontSize: 12,
                                                                letterSpacing: '0.06em',
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
                                                {formatGel(resource.hourlyRate)}/ч
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <button
                                                onClick={() => onToggleResource(resource)}
                                                disabled={toggleBusyId === resource.id}
                                                style={{
                                                    fontFamily: GH_MONO,
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    letterSpacing: '0.06em',
                                                    textTransform: 'uppercase',
                                                    padding: '6px 10px',
                                                    background: resource.isActive === false ? STATUS.danger.bg : GH.ink5,
                                                    color: resource.isActive === false ? STATUS.danger.fg : GH.ink,
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
                                                {resource.isActive === false ? 'Скрыт · показать' : 'Скрыть'}
                                            </button>
                                            <button
                                                onClick={() => handleEdit(resource)}
                                                style={{
                                                    fontFamily: GH_MONO,
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    letterSpacing: '0.06em',
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

            <ResourceModal resource={editingResource} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} locations={locations} />
        </div>
    );
}
