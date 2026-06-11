import { Link } from 'react-router-dom';
import { ChevronRight, MapPin } from 'lucide-react';
import { LOCATIONS, RESOURCES } from '../../utils/data';

/**
 * Mobile listing of locations + cabinets.
 *
 * Entry point for /m/location/:id and /m/cabinet/:id deep-link pages —
 * before this, the mobile shell had no UI way to reach them (only via
 * direct URLs). Linked from /m/me → «Наши центры».
 */
export function MobilePlaces() {
    // neo_school is the historical 3rd location not currently used for
    // active bookings; hide it from the catalog. Capsules are listed as
    // separate cabinets too.
    const locations = LOCATIONS.filter(l => l.id !== 'neo_school');

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                    Наши центры
                </h1>
                <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    Тапни на центр или конкретный кабинет — фото, описание, цена.
                </p>
            </div>

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {locations.map(loc => {
                    const cabinets = RESOURCES.filter(r =>
                        r.locationId === loc.id && r.isActive !== false
                    ).sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
                    return (
                        <div
                            key={loc.id}
                            style={{
                                background: '#fff',
                                border: '1px solid rgba(0,0,0,0.08)',
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
                                    background: '#0E0E0E',
                                    color: '#fff',
                                    textDecoration: 'none',
                                    fontFamily: 'inherit',
                                }}
                            >
                                <MapPin size={16} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 16, fontWeight: 700 }}>{loc.name}</div>
                                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                                        {loc.address}
                                    </div>
                                </div>
                                <ChevronRight size={16} style={{ opacity: 0.7 }} />
                            </Link>

                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {cabinets.length === 0 && (
                                    <div style={{ padding: 16, fontSize: 13, color: '#999' }}>
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
                                            borderTop: '1px solid rgba(0,0,0,0.05)',
                                            color: '#0E0E0E',
                                            textDecoration: 'none',
                                            fontFamily: 'inherit',
                                        }}
                                    >
                                        <div style={{
                                            width: 36, height: 36,
                                            borderRadius: 10,
                                            background: '#F4F4F2',
                                            backgroundImage: r.photos?.[0] ? `url(${r.photos[0]})` : undefined,
                                            backgroundSize: 'cover',
                                            backgroundPosition: 'center',
                                            flexShrink: 0,
                                        }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 14, fontWeight: 700 }}>
                                                {r.name}
                                            </div>
                                            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                                                {r.area} м² · до {r.capacity} чел. · {r.hourlyRate} ₾/ч
                                            </div>
                                        </div>
                                        <ChevronRight size={14} style={{ color: '#999' }} />
                                    </Link>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
