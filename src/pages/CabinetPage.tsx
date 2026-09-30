/**
 * Cabinet detail page — /cabinet/:resourceId и /m/cabinet/:resourceId
 *
 * Design direction: Vignelli's Unigrid (1977 National Park Service catalog +
 * Unimark exhibition catalogs). Photographs treated as EVIDENCE, not mood.
 * Two-column grid: left = data spine (name + fact table + description +
 * booking CTA), right = hero photo + stacked secondary photos.
 *
 * Волна 2, пакет B (G2-15, G2-02, X5-17):
 *  - внутри /m — без MinimalLayout и чёрной полосы крошек: одна шапка
 *    MobilePageHeader со стрелкой «Назад», все ссылки остаются в /m (catalogPath);
 *  - на компьютере — общая PublicHeader, крошки в её подстроке;
 *  - на узком экране фото идёт ПЕРВЫМ, остальные кадры — лентой, а кнопка
 *    «Забронировать · 20 ₾/ч» прилипает к низу (над нижним меню в /m);
 *  - превью WebP вместо оригиналов 1280×960 в миниатюрах;
 *  - закрытый кабинет (isActive: false, сейчас кабинет 9) не показываем.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { RESOURCES, LOCATIONS, CABINET_SERVICES } from '../utils/data';
import { useBookingStore } from '../store/bookingStore';
import { COLOR, FONT, Z } from '../design/tokens';
import { formatGel } from '../utils/format';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useCatalogPath, useInMobileShell } from '../utils/catalogPath';
import { photoSrcSet, photoVariant } from '../utils/cabinetPhotos';
import { PublicHeader } from '../components/public/PublicHeader';
import { MobilePageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { PhotoLightbox } from '../components/catalog/PhotoLightbox';
import { PhotoStrip } from '../components/catalog/PhotoStrip';

export function CabinetPage() {
    const { resourceId } = useParams<{ resourceId: string }>();
    const navigate = useNavigate();
    const setStep = useBookingStore(s => s.setStep);
    const inShell = useInMobileShell();
    const toCatalog = useCatalogPath();
    const wide = useMediaQuery('(min-width: 900px)');
    const [lightbox, setLightbox] = useState<number | null>(null);

    const resource = useMemo(
        () => RESOURCES.find(r => r.id === resourceId),
        [resourceId],
    );
    const location = useMemo(
        () => resource ? LOCATIONS.find(l => l.id === resource.locationId) : null,
        [resource],
    );
    // Кабинет 9 закрыт (владелец, 30.09): старые ссылки ведут на его центр.
    const closed = !!resource && resource.isActive === false;

    useDocumentTitle(resource && !closed ? resource.name : null);

    useEffect(() => {
        if (!resource) {
            // Неизвестный кабинет — в каталог, а не на полупустую страницу.
            navigate(inShell ? '/m/places' : '/', { replace: true });
        } else if (closed) {
            navigate(toCatalog(`/location/${resource.locationId}`), { replace: true });
        }
    }, [resource, closed, navigate, inShell, toCatalog]);

    if (!resource || !location || closed) return null;

    const photos = resource.photos && resource.photos.length > 0
        ? resource.photos
        : ['/img/offices/miniature_cab_1_pal.jpg'];

    const hero = photos[0];
    const secondary = photos.slice(1);
    const altFor = (i: number) => `${resource.name}, ${location.name} — фото ${i + 1} из ${photos.length}`;
    const rateLabel = `${formatGel(resource.hourlyRate)}/ч`;

    const facts: Array<[string, string]> = [
        ['Площадь',     `${resource.area} м²`],
        ['Вместимость', `до ${resource.capacity} чел.`],
        ['Ставка',      `${rateLabel}${resource.groupRate ? ` · группа ${formatGel(resource.groupRate)}/ч` : ''}`],
        ['Форматы',     (resource.formats ?? ['individual']).map(formatLabel).join(' · ')],
    ];

    const services = (resource.services ?? [])
        .map(s => CABINET_SERVICES.find(x => x.id === s)?.label)
        .filter((x): x is string => !!x);

    const handleBook = () => {
        // В приложении и на телефоне — мобильный поиск /m/find с этим кабинетом
        // (шаг 30 мин, длительность одним тапом). Старый /checkout на телефоне
        // округлял старт к целому часу и требовал тыкать слоты по одному.
        if (inShell || (typeof window !== 'undefined' && window.innerWidth < 768)) {
            navigate(`/m/find?cab=${resource.id}`);
            return;
        }
        setStep(2);
        navigate('/checkout');
    };

    const crumbs = (
        <nav aria-label="Где вы" style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: GH.ink60,
        }}>
            <Link to={toCatalog('/')} style={crumbLink}>Unbox</Link>
            <span aria-hidden="true">/</span>
            <Link to={toCatalog(`/location/${location.id}`)} style={crumbLink}>{location.name}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page" style={{ color: GH.ink }}>{resource.name}</span>
        </nav>
    );

    // Липкая кнопка брони на узком экране: в /m — над нижним меню и в ширину
    // оболочки (480), на сайте — у нижнего края.
    const stickyCta = !wide;

    return (
        <div style={{ background: GH.paper, color: GH.ink, fontFamily: GH_SANS, minHeight: inShell ? undefined : '100vh' }}>
            <PublicHeader subnav={crumbs} />
            {inShell && (
                <MobilePageHeader title={resource.name} fallbackTo={`/m/location/${location.id}`} />
            )}

            <div style={{
                maxWidth: 1280, margin: '0 auto',
                padding: wide ? '40px 24px 80px' : `16px 16px ${stickyCta ? 112 : 48}px`,
            }}>
                <div className="cabpg-grid">
                    {/* ── Data spine ── */}
                    <aside className="cabpg-spine">
                        <h1 style={{
                            margin: 0,
                            fontSize: 'clamp(28px, 5vw, 56px)',
                            fontWeight: 600,
                            lineHeight: 1.05,
                            letterSpacing: '-0.02em',
                        }}>
                            {resource.name}
                        </h1>

                        <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.name} ${location.address} Batumi`)}`}
                            target="_blank" rel="noopener noreferrer"
                            style={{
                                marginTop: 8,
                                minHeight: 44,
                                fontSize: 14,
                                color: GH.ink60, textDecoration: 'none',
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                            }}
                        >
                            <MapPin size={14} aria-hidden="true" />
                            <span style={{ borderBottom: `1px solid ${GH.ink10}` }}>{location.name} · {location.address}</span>
                        </a>

                        <dl style={{ margin: '16px 0 0', padding: 0, borderTop: `1px solid ${GH.ink}` }}>
                            {facts.map(([label, value]) => (
                                <div key={label} style={{
                                    display: 'grid',
                                    gridTemplateColumns: '120px minmax(0, 1fr)',
                                    gap: 12,
                                    padding: '12px 0',
                                    borderBottom: `1px solid ${GH.ink10}`,
                                    alignItems: 'baseline',
                                }}>
                                    <dt style={{ fontSize: 14, color: GH.ink60 }}>{label}</dt>
                                    <dd style={{ margin: 0, fontSize: 16, fontWeight: 500, color: GH.ink }}>{value}</dd>
                                </div>
                            ))}
                        </dl>

                        {resource.description && (
                            <p style={{ margin: '24px 0 0', fontSize: 16, lineHeight: 1.55, color: GH.ink, maxWidth: 460 }}>
                                {resource.description}
                            </p>
                        )}

                        {services.length > 0 && (
                            <div style={{ marginTop: 24 }}>
                                <div style={{
                                    fontFamily: GH_MONO, fontSize: 12,
                                    letterSpacing: '0.06em', textTransform: 'uppercase',
                                    color: GH.ink60, marginBottom: 8,
                                }}>
                                    Оборудование
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {services.map(s => (
                                        <span key={s} style={{
                                            padding: '4px 10px',
                                            border: `1px solid ${GH.ink20}`,
                                            fontSize: 14,
                                        }}>{s}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {!stickyCta && (
                            <div style={{ marginTop: 32 }}>
                                <Button block size="touch" onClick={handleBook}>
                                    Забронировать · <span className="num">{rateLabel}</span>
                                </Button>
                            </div>
                        )}
                    </aside>

                    {/* ── Фото. На узком экране — первым (CSS order). ── */}
                    <div className="cabpg-photos">
                        <button
                            type="button"
                            onClick={() => setLightbox(0)}
                            style={{
                                padding: 0, margin: 0, border: 'none', background: 'none',
                                width: '100%', cursor: 'zoom-in', display: 'block',
                            }}
                            aria-label={`${altFor(0)} — открыть`}
                        >
                            <img
                                src={wide ? hero : photoVariant(hero, 'md')}
                                srcSet={photoSrcSet(hero)}
                                sizes="(min-width: 900px) 60vw, 100vw"
                                alt={altFor(0)}
                                fetchPriority="high"
                                style={{
                                    width: '100%', aspectRatio: wide ? '16 / 10' : '4 / 3',
                                    objectFit: 'cover', display: 'block',
                                    background: GH.ink5,
                                }}
                            />
                        </button>

                        {secondary.length > 0 && (wide ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 1 }}>
                                {secondary.map((p, i) => (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setLightbox(i + 1)}
                                        style={{ padding: 0, margin: 0, border: 'none', background: 'none', cursor: 'zoom-in', display: 'block' }}
                                        aria-label={`${altFor(i + 1)} — открыть`}
                                    >
                                        <img
                                            src={photoVariant(p, 'md')}
                                            alt={altFor(i + 1)}
                                            loading="lazy"
                                            decoding="async"
                                            style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block', background: GH.ink5 }}
                                        />
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div style={{ marginTop: 8 }}>
                                <PhotoStrip
                                    photos={secondary}
                                    onOpen={i => setLightbox(i + 1)}
                                    altFor={i => altFor(i + 1)}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <SiblingCabinets currentId={resource.id} locationId={location.id} toCatalog={toCatalog} />

            {stickyCta && (
                <div style={{
                    position: 'fixed',
                    left: '50%', transform: 'translateX(-50%)',
                    width: '100%', maxWidth: inShell ? 480 : undefined,
                    bottom: inShell ? 'calc(72px + env(safe-area-inset-bottom, 0px))' : 0,
                    padding: inShell ? '8px 16px' : '8px 16px calc(8px + env(safe-area-inset-bottom, 0px))',
                    background: COLOR.card,
                    borderTop: `1px solid ${COLOR.ink10}`,
                    zIndex: Z.sticky,
                }}>
                    <Button block size="touch" onClick={handleBook}>
                        Забронировать · <span className="num">{rateLabel}</span>
                    </Button>
                </div>
            )}

            {lightbox !== null && (
                <PhotoLightbox
                    photos={photos}
                    index={lightbox}
                    onClose={() => setLightbox(null)}
                    onIndexChange={setLightbox}
                    altFor={altFor}
                    label={`Фото: ${resource.name}`}
                />
            )}

            <style>{`
                .cabpg-grid {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr);
                    gap: 24px;
                }
                .cabpg-photos { order: -1; }
                @media (min-width: 900px) {
                    .cabpg-grid {
                        grid-template-columns: minmax(320px, 420px) 1fr;
                        gap: 48px;
                        align-items: start;
                    }
                    .cabpg-photos { order: 0; }
                    .cabpg-spine {
                        position: sticky;
                        top: 88px;
                        padding-right: 32px;
                        border-right: 1px solid ${GH.ink};
                    }
                }
            `}</style>
        </div>
    );
}

const crumbLink: React.CSSProperties = {
    color: 'inherit', textDecoration: 'none',
    minHeight: 36, display: 'inline-flex', alignItems: 'center',
};

function SiblingCabinets({ currentId, locationId, toCatalog }: {
    currentId: string;
    locationId: string;
    toCatalog: (path: string) => string;
}) {
    const siblings = RESOURCES
        .filter(r => r.locationId === locationId && r.id !== currentId && r.isActive !== false)
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));

    if (siblings.length === 0) return null;

    return (
        <div style={{
            background: GH.ink5,
            borderTop: `1px solid ${GH.ink}`,
            padding: '32px 16px 48px',
        }}>
            <div style={{ maxWidth: 1280, margin: '0 auto' }}>
                <h2 style={{
                    fontFamily: GH_MONO, fontSize: 12, fontWeight: 500,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: GH.ink60, margin: '0 0 16px',
                }}>
                    Другие кабинеты в этом центре
                </h2>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))',
                    gap: 16,
                }}>
                    {siblings.map(r => (
                        <Link
                            key={r.id}
                            to={toCatalog(`/cabinet/${r.id}`)}
                            style={{
                                background: GH.paper,
                                border: `1px solid ${GH.ink20}`,
                                textDecoration: 'none',
                                color: GH.ink,
                                display: 'block',
                            }}
                        >
                            {r.photos && r.photos[0] && (
                                <img
                                    src={photoVariant(r.photos[0], 'sm')}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                                />
                            )}
                            <div style={{ padding: 14 }}>
                                <div style={{ fontWeight: 600, fontSize: 16 }}>{r.name}</div>
                                <div style={{ fontSize: 14, color: GH.ink60, marginTop: 4, fontFamily: FONT.sans }}>
                                    {r.area} м² · до {r.capacity} чел. · <span className="num">{formatGel(r.hourlyRate)}/ч</span>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}

function formatLabel(f: string): string {
    switch (f) {
        case 'individual':  return 'Индивидуально';
        case 'group':       return 'Группа';
        case 'intervision': return 'Интервизия';
        default:            return f;
    }
}
