import { MapPin } from 'lucide-react';
import { LOCATIONS, RESOURCES } from '../../utils/data';
import { COLOR, RADIUS, TEXT } from '../../design/tokens';
import { ListGroup, ListIcon, ListRow } from '../../components/ui/ListRow';
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
            <p style={{ fontSize: TEXT.small, color: COLOR.ink60, margin: 0, padding: '0 16px' }}>
                Нажмите на центр или кабинет — фото, описание, цена.
            </p>

            {/* 09.11 фаза 3: центр — общий ListGroup с подписью, без тёмной плиты-шапки
                (на экране было две чёрные плашки подряд); превью кабинета 64×64, радиус 8. */}
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
                {locations.map(loc => {
                    const cabinets = RESOURCES.filter(r =>
                        r.locationId === loc.id && r.isActive !== false
                    ).sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
                    return (
                        <ListGroup key={loc.id} title={loc.name}>
                            <ListRow
                                to={`/m/location/${loc.id}`}
                                lead={<ListIcon><MapPin size={20} /></ListIcon>}
                                title={loc.address}
                                subtitle="О центре: фото, как добраться"
                            />
                            {cabinets.length === 0 && (
                                <ListRow title={<span style={{ fontWeight: 400, color: COLOR.ink60 }}>Кабинеты пока скрыты.</span>} />
                            )}
                            {cabinets.map(r => (
                                <ListRow
                                    key={r.id}
                                    to={`/m/cabinet/${r.id}`}
                                    lead={
                                        <span style={{
                                            width: 64, height: 64,
                                            borderRadius: RADIUS.control,
                                            background: COLOR.sunken,
                                            overflow: 'hidden',
                                            flexShrink: 0,
                                            display: 'block',
                                        }}>
                                            {r.photos?.[0] && (
                                                <img
                                                    src={photoVariant(r.photos[0], 'sm')}
                                                    alt=""
                                                    loading="lazy"
                                                    decoding="async"
                                                    width={64}
                                                    height={64}
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                                />
                                            )}
                                        </span>
                                    }
                                    title={r.name}
                                    subtitle={<>{r.area} м² · до {r.capacity} чел.</>}
                                    trail={<span className="num">{formatGel(r.hourlyRate)}/ч</span>}
                                />
                            ))}
                        </ListGroup>
                    );
                })}
            </div>
        </div>
        </>
    );
}
