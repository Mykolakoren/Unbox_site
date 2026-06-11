/**
 * Cabinet detail page — /cabinet/:resourceId
 *
 * Design direction: Vignelli's Unigrid (1977 National Park Service catalog +
 * Unimark exhibition catalogs). Photographs treated as EVIDENCE, not mood.
 * Two-column grid: left = data spine (name + mono fact table + description +
 * booking CTA), right = hero photo + stacked secondary photos.
 *
 * Why this and not a masonry/Airbnb gallery: therapists choose where to host
 * their clients — they need to see the room is clean, lit, undecorated. A
 * catalog-grade layout says "we take this seriously" without writing a single
 * self-congratulatory word. Plus it matches GH (IBM Plex + monochrome ink)
 * which is literally Vignelli's typographic palette.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, MapPin, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { MinimalLayout } from '../components/MinimalLayout';
import { RESOURCES, LOCATIONS, CABINET_SERVICES } from '../utils/data';
import { useBookingStore } from '../store/bookingStore';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

export function CabinetPage() {
    const { resourceId } = useParams<{ resourceId: string }>();
    const navigate = useNavigate();
    const setStep = useBookingStore(s => s.setStep);
    const [lightbox, setLightbox] = useState<number | null>(null);

    const resource = useMemo(
        () => RESOURCES.find(r => r.id === resourceId),
        [resourceId],
    );
    const location = useMemo(
        () => resource ? LOCATIONS.find(l => l.id === resource.locationId) : null,
        [resource],
    );

    useEffect(() => {
        if (!resource) {
            // Unknown resource — bounce home rather than render a half-page.
            navigate('/', { replace: true });
        }
    }, [resource, navigate]);

    if (!resource || !location) return null;

    const photos = resource.photos && resource.photos.length > 0
        ? resource.photos
        : ['/img/offices/miniature_cab_1_pal.jpg'];

    const hero = photos[0];
    const secondary = photos.slice(1);

    // Format the fact table with the same vocabulary the wizard uses.
    // Keys are mono-uppercased per Vignelli's signature for tabular data.
    const facts: Array<[string, string]> = [
        ['ПЛОЩАДЬ',     `${resource.area} м²`],
        ['ВМЕСТИМОСТЬ', `до ${resource.capacity} чел.`],
        ['СТАВКА',      `${resource.hourlyRate} ₾/ч${resource.groupRate ? ` · группа ${resource.groupRate} ₾/ч` : ''}`],
        ['ФОРМАТЫ',     (resource.formats ?? ['individual']).map(formatLabel).join(' · ')],
    ];

    const services = (resource.services ?? [])
        .map(s => CABINET_SERVICES.find(x => x.id === s)?.label)
        .filter((x): x is string => !!x);

    const handleBook = () => {
        setStep(2);
        navigate('/checkout');
    };

    return (
        <MinimalLayout glassMode noPadding>
            <div style={{ background: GH.paper, color: GH.ink, fontFamily: GH_SANS }}>
                {/* Black breadcrumb bar — Vignelli's National Park Service spine.
                    A solid black slab carries the location name in inverted Plex Mono. */}
                <div style={{ background: GH.ink, color: GH.paper, padding: '14px 24px' }}>
                    <div style={{
                        maxWidth: 1280, margin: '0 auto',
                        display: 'flex', alignItems: 'center', gap: 12,
                        fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                    }}>
                        <Link to="/" style={{ color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                            <ArrowLeft size={14} /> Unbox
                        </Link>
                        <span style={{ opacity: 0.4 }}>/</span>
                        <Link to={`/location/${location.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                            {location.name}
                        </Link>
                        <span style={{ opacity: 0.4 }}>/</span>
                        <span>{resource.name}</span>
                    </div>
                </div>

                <div style={{
                    maxWidth: 1280, margin: '0 auto',
                    padding: '40px 24px 80px',
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr)',
                    gap: 0,
                }}>
                    <div className="cabpg-grid">
                        {/* ── LEFT: Data spine ── */}
                        <aside style={{ borderRight: `1px solid ${GH.ink}` }} className="cabpg-spine">
                            <h1 style={{
                                margin: 0,
                                fontSize: 'clamp(40px, 5vw, 64px)',
                                fontWeight: 800,
                                lineHeight: 0.95,
                                letterSpacing: '-0.03em',
                            }}>
                                {resource.name}
                            </h1>

                            {/* Address line — mono, restrained, with map link */}
                            <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.name} ${location.address} Batumi`)}`}
                                target="_blank" rel="noopener noreferrer"
                                style={{
                                    marginTop: 12,
                                    fontFamily: GH_MONO, fontSize: 12,
                                    letterSpacing: '0.08em', textTransform: 'uppercase',
                                    color: GH.ink60, textDecoration: 'none',
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    borderBottom: `1px solid ${GH.ink10}`,
                                    paddingBottom: 2,
                                }}
                            >
                                <MapPin size={12} /> {location.name} · {location.address}
                            </a>

                            {/* Fact table — Vignelli's tabular block.
                                Mono labels on left, values right, hairline rules. */}
                            <dl style={{
                                margin: '32px 0 0',
                                padding: 0,
                                borderTop: `1px solid ${GH.ink}`,
                            }}>
                                {facts.map(([label, value]) => (
                                    <div key={label} style={{
                                        display: 'grid',
                                        // На phone-width 140px метка съедает почти всё —
                                        // переходим на колонку, на десктопе сохраняется.
                                        gridTemplateColumns: 'minmax(0, 1fr)',
                                        gap: 4,
                                        padding: '12px 0',
                                        borderBottom: `1px solid ${GH.ink10}`,
                                        alignItems: 'baseline',
                                    }}
                                    className="cabinet-fact-row">
                                        <dt style={{
                                            fontFamily: GH_MONO, fontSize: 10,
                                            letterSpacing: '0.18em', textTransform: 'uppercase',
                                            color: GH.ink60,
                                        }}>{label}</dt>
                                        <dd style={{
                                            margin: 0,
                                            fontSize: 15, fontWeight: 500,
                                            color: GH.ink,
                                        }}>{value}</dd>
                                    </div>
                                ))}
                            </dl>

                            {/* Body — single paragraph, single column, max 60 words */}
                            <p style={{
                                margin: '28px 0 0',
                                fontSize: 15, lineHeight: 1.55,
                                color: GH.ink,
                                maxWidth: 460,
                            }}>
                                {resource.description}
                            </p>

                            {/* Service list — only if any. Mono chips, no emoji. */}
                            {services.length > 0 && (
                                <div style={{ marginTop: 24 }}>
                                    <div style={{
                                        fontFamily: GH_MONO, fontSize: 10,
                                        letterSpacing: '0.18em', textTransform: 'uppercase',
                                        color: GH.ink60, marginBottom: 8,
                                    }}>
                                        Оборудование
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {services.map(s => (
                                            <span key={s} style={{
                                                padding: '4px 10px',
                                                border: `1px solid ${GH.ink}`,
                                                fontFamily: GH_MONO,
                                                fontSize: 11,
                                                letterSpacing: '0.04em',
                                            }}>{s}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* CTA — ink-black slab, no rounding, no shadow */}
                            <button
                                onClick={handleBook}
                                style={{
                                    marginTop: 36,
                                    width: '100%',
                                    background: GH.ink,
                                    color: GH.paper,
                                    border: 'none',
                                    padding: '16px 20px',
                                    fontFamily: GH_MONO,
                                    fontSize: 13,
                                    fontWeight: 700,
                                    letterSpacing: '0.16em',
                                    textTransform: 'uppercase',
                                    cursor: 'pointer',
                                }}
                            >
                                Забронировать
                            </button>
                        </aside>

                        {/* ── RIGHT: Hero + vertical stack ── */}
                        <div className="cabpg-photos">
                            {/* Hero — large 16:9, fills column width */}
                            <button
                                type="button"
                                onClick={() => setLightbox(0)}
                                style={{
                                    padding: 0, margin: 0, border: 'none', background: 'none',
                                    width: '100%', cursor: 'zoom-in', display: 'block',
                                }}
                                aria-label="Открыть фото в полном размере"
                            >
                                <img
                                    src={hero}
                                    alt={resource.name}
                                    style={{
                                        width: '100%', aspectRatio: '16 / 10',
                                        objectFit: 'cover', display: 'block',
                                        background: GH.ink5,
                                    }}
                                />
                            </button>

                            {/* Stacked secondary photos — vertical, 4:3, hairline gap */}
                            {secondary.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 1 }}>
                                    {secondary.map((p, i) => (
                                        <button
                                            key={p}
                                            type="button"
                                            onClick={() => setLightbox(i + 1)}
                                            style={{
                                                padding: 0, margin: 0, border: 'none',
                                                background: 'none', cursor: 'zoom-in',
                                                display: 'block',
                                            }}
                                            aria-label={`Фото ${i + 2} из ${photos.length}`}
                                        >
                                            <img
                                                src={p}
                                                alt={`${resource.name} — фото ${i + 2}`}
                                                loading="lazy"
                                                style={{
                                                    width: '100%', aspectRatio: '4 / 3',
                                                    objectFit: 'cover', display: 'block',
                                                    background: GH.ink5,
                                                }}
                                            />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Sibling cabinets — quiet bottom band, mono-labeled */}
                <SiblingCabinets currentId={resource.id} locationId={location.id} />
            </div>

            {/* Lightbox — native dialog with keyboard nav. Click anywhere outside
                the image to close; arrows / ESC keyboard-controlled. */}
            {lightbox !== null && (
                <Lightbox
                    photos={photos}
                    index={lightbox}
                    onClose={() => setLightbox(null)}
                    onNav={(dir) => setLightbox(i => {
                        if (i === null) return null;
                        const next = (i + dir + photos.length) % photos.length;
                        return next;
                    })}
                />
            )}

            {/* Responsive grid — desktop two columns, mobile single column.
                Inline style block keeps the page self-contained (no global CSS bloat). */}
            <style>{`
                .cabpg-grid {
                    display: grid;
                    grid-template-columns: 1fr;
                    gap: 32px;
                }
                @media (min-width: 900px) {
                    .cabpg-grid {
                        grid-template-columns: minmax(320px, 420px) 1fr;
                        gap: 48px;
                        align-items: start;
                    }
                    .cabpg-spine {
                        position: sticky;
                        top: 32px;
                        padding-right: 32px;
                    }
                }
                @media (max-width: 899px) {
                    .cabpg-spine { border-right: none !important; }
                }
            `}</style>
        </MinimalLayout>
    );
}

function Lightbox({ photos, index, onClose, onNav }: {
    photos: string[];
    index: number;
    onClose: () => void;
    onNav: (dir: 1 | -1) => void;
}) {
    const closeRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') onNav(1);
            if (e.key === 'ArrowLeft') onNav(-1);
        };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        closeRef.current?.focus();
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [onClose, onNav]);

    return (
        <div
            role="dialog" aria-modal="true"
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(14,14,14,0.94)',
                zIndex: 9999,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 32,
            }}
        >
            <button
                ref={closeRef}
                onClick={onClose}
                aria-label="Закрыть"
                style={{
                    position: 'absolute', top: 16, right: 16,
                    background: 'none', border: 'none', color: '#fff',
                    cursor: 'pointer', padding: 8,
                }}
            >
                <X size={24} />
            </button>
            {photos.length > 1 && (
                <>
                    <button
                        onClick={(e) => { e.stopPropagation(); onNav(-1); }}
                        aria-label="Предыдущее фото"
                        style={navButtonStyle('left')}
                    ><ChevronLeft size={28} /></button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onNav(1); }}
                        aria-label="Следующее фото"
                        style={navButtonStyle('right')}
                    ><ChevronRight size={28} /></button>
                </>
            )}
            <img
                src={photos[index]}
                alt=""
                onClick={(e) => e.stopPropagation()}
                style={{
                    maxWidth: '92vw', maxHeight: '88vh',
                    objectFit: 'contain', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                }}
            />
            <div style={{
                position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                color: '#fff', fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.18em',
            }}>
                {String(index + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}
            </div>
        </div>
    );
}

function navButtonStyle(side: 'left' | 'right'): React.CSSProperties {
    return {
        position: 'absolute', top: '50%',
        transform: 'translateY(-50%)',
        [side]: 16,
        background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
        cursor: 'pointer', padding: 12,
        display: 'grid', placeItems: 'center',
    } as React.CSSProperties;
}

function SiblingCabinets({ currentId, locationId }: { currentId: string; locationId: string }) {
    const siblings = RESOURCES
        .filter(r => r.locationId === locationId && r.id !== currentId && r.isActive !== false)
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));

    if (siblings.length === 0) return null;

    return (
        <div style={{
            background: GH.ink5,
            borderTop: `1px solid ${GH.ink}`,
            padding: '40px 24px 56px',
        }}>
            <div style={{ maxWidth: 1280, margin: '0 auto' }}>
                <div style={{
                    fontFamily: GH_MONO, fontSize: 10,
                    letterSpacing: '0.18em', textTransform: 'uppercase',
                    color: GH.ink60, marginBottom: 16,
                }}>
                    Другие кабинеты в этом центре
                </div>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 16,
                }}>
                    {siblings.map(r => (
                        <Link
                            key={r.id}
                            to={`/cabinet/${r.id}`}
                            style={{
                                background: GH.paper,
                                border: `1px solid ${GH.ink}`,
                                textDecoration: 'none',
                                color: GH.ink,
                                display: 'block',
                            }}
                        >
                            {r.photos && r.photos[0] && (
                                <img
                                    src={r.photos[0]}
                                    alt={r.name}
                                    loading="lazy"
                                    style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                                />
                            )}
                            <div style={{ padding: 14 }}>
                                <div style={{ fontWeight: 700, fontSize: 16 }}>{r.name}</div>
                                <div style={{
                                    fontFamily: GH_MONO, fontSize: 11,
                                    letterSpacing: '0.08em', textTransform: 'uppercase',
                                    color: GH.ink60, marginTop: 4,
                                }}>
                                    {r.area} м² · до {r.capacity} чел. · {r.hourlyRate} ₾/ч
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
        case 'individual':  return 'Индивид.';
        case 'group':       return 'Группа';
        case 'intervision': return 'Интервиз.';
        default:            return f;
    }
}
