import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../api/client';
import type { Specialist } from '../../components/Specialists/SpecialistCard';
import { COLOR, SHAPE, TEXT } from '../../design/tokens';
import { MobilePageHeader } from '../../components/ui/PageHeader';
import { ListGroup, ListRow } from '../../components/ui/ListRow';
import { Input } from '../../components/ui/Field';
import { ruPlural } from '../../utils/plural';
import { formatGel } from '../../utils/format';
import { SkeletonList } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { Segmented } from '../../components/ui/Chip';
import { hasOnlineFormat, hasOfflineFormat, specializationLabels } from '../../utils/specialistFormat';

/**
 * Mobile catalog of specialists.
 *
 * Native phone-first list, replaces the desktop SpecialistsPage which has
 * a grid layout meant for >=900px. Mobile uses vertical cards: photo,
 * name, tagline, price. Tap → /m/specialists/:id detail.
 */
export function MobileSpecialists() {
    const [items, setItems] = useState<Specialist[] | null>(null);
    // Сбой загрузки ≠ «никого не нашлось» (раньше ошибка превращалась в пустой список).
    const [loadFailed, setLoadFailed] = useState(false);
    const [query, setQuery] = useState('');
    const [format, setFormat] = useState<'all' | 'OFFLINE_ROOM' | 'ONLINE'>('all');

    const load = () => {
        setLoadFailed(false);
        api.get<Specialist[]>('/specialists')
            .then(r => setItems(r.data))
            .catch(() => setLoadFailed(true));
    };
    useEffect(load, []);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (items || []).filter(s => {
            // Волна 2: «Кабинет» — любой OFFLINE-код (в базе их десяток),
            // раньше точное совпадение с OFFLINE_ROOM теряло большинство очных.
            if (format === 'ONLINE' && !hasOnlineFormat(s.formats)) return false;
            if (format === 'OFFLINE_ROOM' && !hasOfflineFormat(s.formats)) return false;
            if (!q) return true;
            const full = `${s.firstName} ${s.lastName}`.toLowerCase();
            const spec = specializationLabels(s.specializations).join(' ').toLowerCase();
            return full.includes(q) || spec.includes(q) || (s.tagline || '').toLowerCase().includes(q);
        });
    }, [items, query, format]);

    return (
        <div style={{ paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 09.11 фаза 3: общая шапка со стрелкой «назад» (сюда приходят из «Я»,
                соседние экраны каталога её уже имеют), поиск — общее поле. */}
            <MobilePageHeader
                title="Специалисты"
                fallbackTo="/m/me"
                subtitle={items === null ? (loadFailed ? undefined : 'Загружаем…') : `${items.length} ${ruPlural(items.length, ['специалист', 'специалиста', 'специалистов'])}`}
            />

            <div style={{ padding: '0 16px', position: 'relative' }}>
                <Search size={18} color={COLOR.ink60} aria-hidden="true" style={{ position: 'absolute', left: 28, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <Input
                    kind="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Имя, специализация…"
                    aria-label="Поиск специалиста"
                    style={{ paddingLeft: 40 }}
                />
            </div>

            <div style={{ padding: '0 16px' }}>
                {/* Wave 1: общий Segmented (44 px, aria-pressed). */}
                <Segmented
                    aria-label="Формат приёма"
                    value={format}
                    onChange={setFormat}
                    options={[
                        { value: 'all', label: 'Все' },
                        { value: 'OFFLINE_ROOM', label: 'Кабинет' },
                        { value: 'ONLINE', label: 'Онлайн' },
                    ]}
                />
            </div>

            {items === null && loadFailed ? (
                <div style={{ padding: '0 16px' }}>
                    <ErrorBar message="Не удалось загрузить специалистов" onRetry={load} />
                </div>
            ) : items === null ? (
                <div style={{ padding: '0 16px' }}>
                    <SkeletonList count={4} cardHeight={80} label="Загружаем специалистов" />
                </div>
            ) : filtered.length === 0 ? (
                <div style={{ padding: '0 16px' }}>
                    <EmptyState
                        compact
                        illustration="chair"
                        title="Никого не нашлось"
                        hint="Попробуйте другое имя или уберите фильтр."
                    />
                </div>
            ) : (
                <div style={{ padding: '0 16px' }}>
                    {/* Одна группа строк вместо отдельной карточки на каждого. */}
                    <ListGroup aria-label="Специалисты">
                        {filtered.map(s => {
                            const recommended = (s.badges || []).includes('recommended');
                            return (
                                <ListRow
                                    key={s.id}
                                    to={`/m/specialists/${s.id}`}
                                    lead={
                                        <span aria-hidden="true" style={{
                                            width: 56, height: 56, borderRadius: SHAPE.pill,
                                            background: COLOR.accentSoft,
                                            backgroundImage: s.photoUrl ? `url(${s.photoUrl})` : undefined,
                                            backgroundSize: 'cover', backgroundPosition: 'center',
                                            flexShrink: 0,
                                            display: 'grid', placeItems: 'center',
                                            fontSize: TEXT.title, fontWeight: 600, color: COLOR.accentInk,
                                        }}>
                                            {!s.photoUrl && `${s.firstName?.[0] ?? ''}${s.lastName?.[0] ?? ''}`.toUpperCase()}
                                        </span>
                                    }
                                    title={`${s.firstName} ${s.lastName}`}
                                    subtitle={s.tagline ? (
                                        <span style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                            {s.tagline}
                                        </span>
                                    ) : undefined}
                                    meta={recommended ? <span className="ui-badge ui-badge--ok">Рекомендуем</span> : undefined}
                                    trail={s.basePriceGel > 0 ? <span className="num">от {formatGel(s.basePriceGel)}</span> : undefined}
                                />
                            );
                        })}
                    </ListGroup>
                </div>
            )}
        </div>
    );
}
