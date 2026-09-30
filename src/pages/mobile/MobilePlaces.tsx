import { Link } from 'react-router-dom';
import { ChevronRight, MapPin } from 'lucide-react';
import { LOCATIONS, RESOURCES } from '../../utils/data';
import { COLOR } from '../../design/tokens';
import { formatGel } from '../../utils/format';
import { MobilePageHeader } from '../../components/ui/PageHeader';
import { photoVariant } from '../../utils/cabinetPhotos';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/**
 * Mobile listing of locations + cabinets.
 *
 * Entry point for /m/location/:id and /m/cabinet/:id deep-link pages —
 * before this, the mobile shell had no UI way to reach them (only via
 * direct URLs). Linked from /m/me → «Наши центры».
 *
 * Волна 2, пакет B: общая шапка со стрелкой «Назад» (G4-client-mobile-M4),
 * миниатюры — WebP 360 px с ленивой загрузкой вместо фоновых JPEG 1280×960
 * (X5-17: экран тянул 1,1 МБ ради картинок 36 px). Только сдаваемые кабинеты.
 */
export function MobilePlaces() {
    // neo_school is the historical 3rd location not currently used for
    // active bookings; hide it from the catalog. Capsules are listed as
    // separate cabinets too.
    const locations = LOCATIONS.filter(l => l.id !== 'neo_school');
    useDocumentTitle('Наши центры');

    return (
        <>
        <MobilePageHeader title="Наши центры" fallbackTo="/m/me" />
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: 14, color: COLOR.ink60, margin: 0, padding: '0 16px' }}>
                Нажмите на центр или кабинет — фото, описание, цена.
            </p>

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {locations.map(loc => {
                    const cabinets = RESOURCES.filter(r =>
                        r.locationId === loc.id && r.isActive !== false
                    ).sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
                    return (
                        <div
                            key={loc.id}
                            style={{
                                background: COLOR.card,
                                border: `1px solid ${COLOR.ink08}`,
                                borderRadius: 14,
                                overflow: 'hidden',
                            }}
                        >
                            <Link
                                to={`/m/location/${loc.id}`}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '14px 16px',
                                    background: COLOR.ink,
                                    color: COLOR.onInk,
                                    textDecoration: 'none',
                                    fontFamily: 'inherit',
                                }}
                            >
                                <MapPin size={16} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 16, fontWeight: 600 }}>{loc.name}</div>
                                    <div style={{ fontSize: 14, marginTop: 2 }}>
                                        {loc.address}
                                    </div>
                                </div>
                                <ChevronRight size={16} aria-hidden="true" />
                            </Link>

                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {cabinets.length === 0 && (
                                    <div style={{ padding: 16, fontSize: 14, color: COLOR.ink60 }}>
                                        Кабинеты пока скрыты.
                                    </div>
                                )}
                                {cabinets.map(r => (
                                    <Link
                                        key={r.id}
                                        to={`/m/cabinet/${r.id}`}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 10,
                                            padding: '12px 14px',
                                            borderTop: `1px solid ${COLOR.ink05}`,
                                            color: COLOR.ink,
                                            textDecoration: 'none',
                                            fontFamily: 'inherit',
                                        }}
                                    >
                                        <div style={{
                                            width: 56, height: 56,
                                            borderRadius: 8,
                                            background: COLOR.sunken,
                                            overflow: 'hidden',
                                            flexShrink: 0,
                                        }}>
                                            {r.photos?.[0] && (
                                                <img
                                                    src={photoVariant(r.photos[0], 'sm')}
                                                    alt=""
                                                    loading="lazy"
                                                    decoding="async"
                                                    width={56}
                                                    height={56}
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                                />
                                            )}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 16, fontWeight: 600 }}>
                                                {r.name}
                                            </div>
                                            <div style={{ fontSize: 14, color: COLOR.ink60, marginTop: 2 }}>
                                                {r.area} м² · до {r.capacity} чел. · <span className="num">{formatGel(r.hourlyRate)}/ч</span>
                                            </div>
                                        </div>
                                        <ChevronRight size={14} aria-hidden="true" style={{ color: COLOR.ink60 }} />
                                    </Link>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
        </>
    );
}
