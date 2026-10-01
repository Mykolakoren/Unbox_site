import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useBookingStore } from '../store/bookingStore';
import { MapPin } from 'lucide-react';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { PRICING_CONFIG } from '../utils/pricingConfig';
import { COLOR } from '../design/tokens';
import { formatGel } from '../utils/format';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { MobilePageHeader } from '../components/ui/PageHeader';
import { PublicHeader } from '../components/public/PublicHeader';
import { PhotoLightbox } from '../components/catalog/PhotoLightbox';
import { PhotoStrip } from '../components/catalog/PhotoStrip';
import { useCatalogPath, useInMobileShell } from '../utils/catalogPath';
import { photoVariant } from '../utils/cabinetPhotos';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * Страница центра — /location/:id и /m/location/:id.
 *
 * Волна 2, пакет B (G2-02, G2-12, G2-14, G2-21, X5-17):
 *  - в /m своей шапки сайта нет — только MobilePageHeader («←» + название);
 *    ссылки на кабинеты остаются в приложении (catalogPath);
 *  - на компьютере — общая PublicHeader;
 *  - фото: сначала по одному кадру каждого кабинета, потом общие зоны;
 *    на телефоне — лента со scroll-snap и счётчиком, на компьютере — полоса
 *    из четырёх кадров; просмотр — общий PhotoLightbox (Esc, свайп);
 *  - в строке кабинета миниатюра 72×72, «Забронировать» — контурная кнопка;
 *  - только сдаваемые кабинеты (isActive !== false).
 */

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

// Папка общих фото центра → сколько кадров 01.jpg…NN.jpg лежит в
// /public/img/cabinets/<slug>/common (листинг папки с клиента не получить).
const COMMON_PHOTO_FOLDERS: Record<string, { slug: string; count: number }> = {
    unbox_one: { slug: 'one', count: 16 },
    unbox_uni: { slug: 'uni', count: 38 },
};

const FALLBACK_PHOTOS = ['/img/offices/miniature_cab_1_pal.jpg', '/img/offices/cabinet_5_ira.jpg', '/img/offices/cabinet_7_liza.webp'];

export function LocationDetailsPage() {
    const { locationId: id } = useParams<{ locationId: string }>();
    const navigate = useNavigate();
    const inShell = useInMobileShell();
    const toCatalog = useCatalogPath();
    const { locations, resources, fetchLocations, fetchResources, setLocation, setStep, setHighlightedResourceId } = useBookingStore();

    useEffect(() => {
        if (locations.length === 0) fetchLocations();
        if (resources.length === 0) fetchResources();
    }, [locations.length, resources.length, fetchLocations, fetchResources]);

    const location = locations.find(loc => loc.id === id);
    useDocumentTitle(location?.name);

    useEffect(() => {
        if (id) setLocation(id);
    }, [id, setLocation]);

    const headers = (title: string) => (
        <>
            <PublicHeader />
            {inShell && <MobilePageHeader title={title} fallbackTo="/m/places" />}
        </>
    );

    if (!location) {
        // Пока филиалы не пришли — силуэт; пришли, а такого нет — честно
        // «не найден» (раньше здесь навсегда висело «Загрузка локации...»).
        return (
            <div style={{ background: GH.paper, color: GH.ink, fontFamily: GH_SANS, minHeight: inShell ? undefined : '100vh' }}>
                {headers('Центр')}
                <div style={{ maxWidth: 920, margin: '0 auto', padding: '32px 16px' }}>
                    {locations.length === 0 ? (
                        <div role="status" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <span className="sr-only">Загружаем центр…</span>
                            <Skeleton height={40} width="60%" />
                            <Skeleton height={16} width="40%" />
                            <Skeleton height={240} />
                        </div>
                    ) : (
                        <EmptyState
                            title="Центр не найден"
                            hint="Возможно, ссылка устарела. Посмотрите все центры Unbox."
                            action={{
                                label: inShell ? 'Все центры' : 'На главную',
                                onClick: () => navigate(inShell ? '/m/places' : '/'),
                            }}
                        />
                    )}
                </div>
            </div>
        );
    }

    // Только сдаваемые кабинеты (кабинет 9 закрыт — isActive: false).
    const locationResources = resources
        .filter(r => r.locationId === id && r.isActive !== false)
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));

    // Порядок фото (G2-14): фото центра → по одному лучшему кадру каждого
    // кабинета → общие зоны (ресепшн, коридор, кухня — владелец 26.05) →
    // остальные кадры кабинетов. Раньше первыми шли 16/38 похожих общих фото.
    const commonCfg = COMMON_PHOTO_FOLDERS[location.id];
    const commonPhotos = commonCfg
        ? Array.from({ length: commonCfg.count }, (_, i) =>
            `/img/cabinets/${commonCfg.slug}/common/${String(i + 1).padStart(2, '0')}.jpg`)
        : [];
    const ordered = [
        ...(location.image ? [location.image] : []),
        ...locationResources.map(r => r.photos?.[0]).filter((p): p is string => !!p),
        ...commonPhotos,
        ...locationResources.flatMap(r => (r.photos ?? []).slice(1)),
    ];
    const deduped = Array.from(new Set(ordered));
    const allPhotos = deduped.length > 0 ? deduped : FALLBACK_PHOTOS;

    const handleBookResource = (resourceId: string) => {
        // В приложении и на телефоне — мобильный поиск /m/find с предвыбранным
        // кабинетом (см. CabinetPage): корректный выбор времени :30 и длительности.
        if (inShell || (typeof window !== 'undefined' && window.innerWidth < 768)) {
            navigate(`/m/find?cab=${resourceId}`);
            return;
        }
        setHighlightedResourceId(resourceId);
        setStep(2);
        navigate('/checkout');
    };

    return (
        <GridHouseLocationDetails
            location={location}
            locationResources={locationResources}
            allPhotos={allPhotos}
            handleBookResource={handleBookResource}
            headers={headers(location.name)}
            inShell={inShell}
            toCatalog={toCatalog}
        />
    );
}


/* ═══════════════════════════════════════════════════════════════
   Grid House — LocationDetailsPage
   ═══════════════════════════════════════════════════════════════ */

const ghldMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const };
const ghldHairline = `1px solid ${GH.ink10}`;

interface GridHouseLocationDetailsProps {
    location: any;
    locationResources: any[];
    allPhotos: string[];
    handleBookResource: (id: string) => void;
    headers: React.ReactNode;
    inShell: boolean;
    toCatalog: (path: string) => string;
}

function GridHouseLocationDetails({
    location, locationResources, allPhotos, handleBookResource, headers, inShell, toCatalog,
}: GridHouseLocationDetailsProps) {
    const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
    const wide = useMediaQuery('(min-width: 768px)');
    const narrow = !wide;
    const altFor = (i: number) => `${location.name} — фото ${i + 1} из ${allPhotos.length}`;
    const minRate = locationResources.length > 0
        ? Math.min(...locationResources.map(r => r.hourlyRate || 0))
        : null;
    const mapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.name} ${location.address} Batumi`)}`;

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, minHeight: inShell ? undefined : '100vh', background: GH.paper }}>
            {headers}

            <div style={{ maxWidth: 1200, margin: '0 auto', padding: narrow ? '16px 16px 48px' : '32px clamp(16px, 4vw, 24px) 80px' }}>
                {/* Заголовок центра. В /m название уже в шапке — здесь адрес и факты. */}
                <div style={{ paddingBottom: narrow ? 16 : 24, borderBottom: `${narrow ? 1 : 2}px solid ${GH.ink}`, marginBottom: narrow ? 16 : 32 }}>
                    {!inShell && (
                        <>
                            <div style={{ ...ghldMono, color: GH.ink60, marginBottom: 8 }}>Центр</div>
                            <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 40px)', fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
                                {location.name}
                            </h1>
                        </>
                    )}
                    <a
                        href={mapHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: GH.ink60, fontSize: 14, minHeight: 44, textDecoration: 'none' }}
                    >
                        <MapPin size={14} aria-hidden="true" style={{ color: GH.accent }} />
                        <span style={{ borderBottom: ghldHairline }}>{location.address}</span>
                    </a>
                    {narrow && locationResources.length > 0 && (
                        <div style={{ fontSize: 14, color: GH.ink60 }}>
                            {locationResources.length} {plural(locationResources.length, 'помещение', 'помещения', 'помещений')}
                            {minRate != null && <> · от <span className="num" style={{ color: GH.ink }}>{formatGel(minRate)}/ч</span></>}
                        </div>
                    )}
                </div>

                {/* KPI strip — только на компьютере */}
                {!narrow && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 0, borderTop: ghldHairline, borderBottom: ghldHairline, marginBottom: 32 }}>
                        <div style={{ padding: '16px 16px 16px 0', borderRight: ghldHairline }}>
                            <div style={{ ...ghldMono, color: GH.ink60, marginBottom: 6 }}>Помещений</div>
                            <div style={{ fontFamily: GH_MONO, fontSize: 40, fontWeight: 600, lineHeight: 1 }}>
                                {locationResources.length}
                            </div>
                        </div>
                        {minRate != null && (
                            <div style={{ padding: 16 }}>
                                <div style={{ ...ghldMono, color: GH.ink60, marginBottom: 6 }}>Цена от</div>
                                <div className="num" style={{ fontFamily: GH_MONO, fontSize: 40, fontWeight: 600, lineHeight: 1, color: GH.accent }}>
                                    {formatGel(minRate)}
                                </div>
                                <div style={{ fontSize: 12, color: GH.ink60, marginTop: 4 }}>в час</div>
                            </div>
                        )}
                    </div>
                )}

                {/* Фото */}
                {allPhotos.length > 0 && (narrow ? (
                    <div style={{ marginBottom: 24 }}>
                        <PhotoStrip photos={allPhotos} onOpen={setGalleryIndex} altFor={altFor} />
                    </div>
                ) : (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 32 }}>
                        {allPhotos.slice(0, 4).map((photo, i) => (
                            <button
                                key={photo}
                                type="button"
                                onClick={() => setGalleryIndex(i)}
                                aria-label={i === 3 && allPhotos.length > 4
                                    ? `Все фото — ${allPhotos.length}`
                                    : `${altFor(i)} — открыть`}
                                style={{
                                    flex: i === 0 ? '2 1 0' : '1 1 0', height: 240,
                                    padding: 0, border: 'none', background: GH.ink5,
                                    cursor: 'zoom-in', overflow: 'hidden', position: 'relative', minWidth: 0,
                                }}
                            >
                                <img
                                    src={photoVariant(photo, 'md')}
                                    alt={altFor(i)}
                                    loading={i === 0 ? 'eager' : 'lazy'}
                                    decoding="async"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                />
                                {i === 3 && allPhotos.length > 4 && (
                                    <span style={{
                                        position: 'absolute', inset: 0, background: 'rgba(14,14,14,0.55)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: COLOR.onInk, fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap',
                                    }}>
                                        Ещё {allPhotos.length - 4} фото
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                ))}

                {/* Кабинеты — сразу после фото: за этим и пришли */}
                {locationResources.length > 0 && (
                    <section style={{ marginBottom: 40 }} aria-labelledby="loc-rooms">
                        <h2 id="loc-rooms" style={{ ...ghldMono, fontWeight: 500, color: GH.ink60, margin: '0 0 12px' }}>Кабинеты и пространства</h2>
                        <div style={{ border: ghldHairline }}>
                            {locationResources.map((resource, i) => (
                                <div
                                    key={resource.id}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: narrow ? '72px minmax(0, 1fr)' : '96px minmax(0, 1fr) auto',
                                        gap: narrow ? 12 : 20,
                                        alignItems: 'center',
                                        padding: narrow ? 12 : '16px 20px',
                                        borderBottom: i < locationResources.length - 1 ? ghldHairline : 'none',
                                    }}
                                >
                                    <Link to={toCatalog(`/cabinet/${resource.id}`)} tabIndex={-1} aria-hidden="true" style={{ display: 'block' }}>
                                        <div style={{
                                            width: narrow ? 72 : 96, height: 72,
                                            background: GH.ink5, overflow: 'hidden',
                                        }}>
                                            {resource.photos?.[0] && (
                                                <img
                                                    src={photoVariant(resource.photos[0], 'sm')}
                                                    alt=""
                                                    loading="lazy"
                                                    decoding="async"
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                                />
                                            )}
                                        </div>
                                    </Link>
                                    <div style={{ minWidth: 0 }}>
                                        <Link
                                            to={toCatalog(`/cabinet/${resource.id}`)}
                                            style={{
                                                fontWeight: 600, fontSize: 16,
                                                color: GH.ink, textDecoration: 'none',
                                                borderBottom: `1px solid ${GH.ink20}`,
                                                display: 'inline-block',
                                            }}
                                        >
                                            {resource.name}
                                        </Link>
                                        <div style={{ fontSize: 14, color: GH.ink60, marginTop: 4 }}>
                                            {resource.type === 'capsule' ? 'Капсула' : 'Кабинет'} · до {resource.capacity} чел.
                                            {resource.area ? ` · ${resource.area} м²` : ''}
                                        </div>
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'baseline' }}>
                                            {resource.formats?.includes('individual') !== false && (
                                                <span className="num" style={{ fontWeight: 600, fontSize: 14 }}>
                                                    {formatGel(resource.hourlyRate)}/ч
                                                </span>
                                            )}
                                            {resource.formats?.includes('group') && (
                                                <span style={rateTag}>группа <span className="num">{formatGel(deriveRate(resource, 'group'))}/ч</span></span>
                                            )}
                                            {resource.formats?.includes('intervision') && (
                                                <span style={rateTag}>интервизия <span className="num">{formatGel(deriveRate(resource, 'intervision'))}/ч</span></span>
                                            )}
                                        </div>
                                        {narrow && (
                                            <div style={{ marginTop: 10 }}>
                                                <Button variant="secondary" size="touch" onClick={() => handleBookResource(resource.id)}>
                                                    Забронировать
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                    {!narrow && (
                                        <Button variant="secondary" size="touch" onClick={() => handleBookResource(resource.id)}>
                                            Забронировать
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {location.description && (
                    <div style={{ marginBottom: 32 }}>
                        <h2 style={{ ...ghldMono, fontWeight: 500, color: GH.ink60, margin: '0 0 12px' }}>О центре</h2>
                        <p style={{ fontSize: 16, color: GH.ink80, lineHeight: 1.6, maxWidth: 700, margin: 0 }}>
                            {location.description}
                        </p>
                    </div>
                )}

                {location.features && location.features.length > 0 && (
                    <div style={{ marginBottom: 32 }}>
                        <h2 style={{ ...ghldMono, fontWeight: 500, color: GH.ink60, margin: '0 0 12px' }}>Удобства</h2>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {location.features.map((feat: string, i: number) => (
                                <span key={i} style={{ fontSize: 14, color: GH.ink80, padding: '6px 12px', border: ghldHairline }}>
                                    {feat}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {!inShell && (
                    <footer style={{ borderTop: `2px solid ${GH.ink}`, padding: '16px 0', display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ ...ghldMono, color: GH.ink60 }}>Unbox · 2026</span>
                        <span style={{ ...ghldMono, color: GH.ink60 }}>Батуми · Грузия</span>
                    </footer>
                )}
            </div>

            {galleryIndex !== null && (
                <PhotoLightbox
                    photos={allPhotos}
                    index={galleryIndex}
                    onClose={() => setGalleryIndex(null)}
                    onIndexChange={setGalleryIndex}
                    altFor={altFor}
                    label={`Фото: ${location.name}`}
                />
            )}
        </div>
    );
}

const rateTag: React.CSSProperties = {
    fontSize: 12, color: GH.ink80, fontWeight: 500,
    background: GH.ink5, padding: '2px 8px',
};

function plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}
