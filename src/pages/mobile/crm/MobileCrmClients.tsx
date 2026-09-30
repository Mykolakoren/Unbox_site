import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, Search, MessageCircle, X } from 'lucide-react';
import { useCrmStore } from '../../../store/crmStore';
import { Segmented } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { COLOR } from '../../../design/tokens';

/**
 * Mobile CRM — clients list with search.
 *
 * Plain alphabetical list with a sticky search box on top. Tap → client
 * card (separate route). Active filter: hide archived/inactive.
 *
 * Wave 1: «Только активные» — переключатель «Активные / Все» вместо
 * синего системного чекбокса; звонок и Telegram — соседние кнопки 44 px,
 * а не ссылки внутри ссылки (ошибка «<a> cannot contain <a>»);
 * загрузка/ошибка/пусто — три разных состояния; честная подсказка вместо
 * «добавьте через десктоп».
 */
export function MobileCrmClients() {
    const { clients, fetchClients } = useCrmStore();
    const [query, setQuery] = useState('');
    const [activeOnly, setActiveOnly] = useState(true);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    const load = () => {
        setLoading(true);
        setFailed(false);
        fetchClients(false)
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        if (clients.length === 0) load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clients.length, fetchClients]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        let list = clients;
        if (activeOnly) list = list.filter(c => c.isActive);
        if (q) {
            list = list.filter(c =>
                c.name?.toLowerCase().includes(q)
                || c.phone?.toLowerCase().includes(q)
                || c.email?.toLowerCase().includes(q)
                || c.aliasCode?.toLowerCase().includes(q)
            );
        }
        return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    }, [clients, query, activeOnly]);

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                    Клиенты
                </h1>
                <p style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                    {loading && clients.length === 0 ? 'Загружаем…' : `Всего: ${clients.length} · показано: ${filtered.length}`}
                </p>
            </div>

            {/* Search */}
            <div style={{ padding: '0 16px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: 'var(--color-sunken)',
                    borderRadius: 12,
                    padding: '0 0 0 12px',
                    minHeight: 44,
                    gap: 8,
                }}>
                    <Search size={16} color={COLOR.ink60} aria-hidden="true" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        aria-label="Поиск клиента"
                        placeholder="Имя, телефон, email…"
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            fontSize: 16,
                            fontFamily: 'inherit',
                            color: 'var(--color-ink)',
                            minWidth: 0,
                        }}
                    />
                    {query && (
                        <button
                            onClick={() => setQuery('')}
                            aria-label="Очистить поиск"
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--color-ink-60)', width: 44, height: 44,
                                display: 'grid', placeItems: 'center', flexShrink: 0,
                            }}
                        >
                            <X size={16} aria-hidden="true" />
                        </button>
                    )}
                </div>
                <Segmented<'active' | 'all'>
                    aria-label="Каких клиентов показать"
                    className="mt-2"
                    options={[
                        { value: 'active', label: 'Активные' },
                        { value: 'all', label: 'Все' },
                    ]}
                    value={activeOnly ? 'active' : 'all'}
                    onChange={v => setActiveOnly(v === 'active')}
                />
            </div>

            {failed && !loading && (
                <div style={{ padding: '0 16px' }}>
                    <ErrorBar message="Не удалось загрузить клиентов" onRetry={load} />
                </div>
            )}

            {loading && clients.length === 0 && (
                <div style={{ padding: '0 16px' }}>
                    <SkeletonList count={5} label="Загружаем клиентов" cardHeight={60} />
                </div>
            )}

            {!loading && !failed && filtered.length === 0 && (
                <div style={{ padding: '0 16px' }}>
                    {query ? (
                        <EmptyState compact title="Никого не нашлось" hint="Попробуйте другое имя, телефон или код." />
                    ) : (
                        <EmptyState
                            compact
                            title="Клиентов пока нет"
                            hint="Добавьте встречу в Google Календарь — клиент появится после синхронизации. Или заведите клиента на компьютере."
                        />
                    )}
                </div>
            )}

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.map(c => (
                    <div
                        key={c.id}
                        style={{
                            background: 'var(--color-card)',
                            border: '1px solid var(--color-ink-08)',
                            borderRadius: 12,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            paddingRight: 6,
                        }}
                    >
                        <Link
                            to={`/m/crm/clients/${c.id}`}
                            style={{
                                flex: 1,
                                minWidth: 0,
                                padding: '12px 8px 12px 14px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                color: 'var(--color-ink)',
                                textDecoration: 'none',
                            }}
                        >
                            <div style={{
                                width: 36, height: 36,
                                borderRadius: 999,
                                background: 'var(--color-sunken)',
                                display: 'grid', placeItems: 'center',
                                fontSize: 14, fontWeight: 600,
                                color: 'var(--color-ink-60)',
                                flexShrink: 0,
                            }}>
                                {(c.name || '?').slice(0, 1).toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {c.aliasCode ? `${c.aliasCode} · ${c.name}` : c.name}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {c.phone || c.email || (c.tags?.length ? c.tags.slice(0, 2).join(', ') : '—')}
                                </div>
                            </div>
                        </Link>
                        {c.phone && (
                            <a
                                href={`tel:${c.phone.replace(/\s/g, '')}`}
                                aria-label={`Позвонить: ${c.name}`}
                                style={iconBtn}
                            >
                                <Phone size={16} aria-hidden="true" />
                            </a>
                        )}
                        {c.telegram && (
                            <a
                                href={`https://t.me/${c.telegram.replace('@', '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Написать в Telegram: ${c.name}`}
                                style={iconBtn}
                            >
                                <MessageCircle size={16} aria-hidden="true" />
                            </a>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

const iconBtn: React.CSSProperties = {
    width: 44, height: 44,
    borderRadius: 8,
    background: 'var(--color-sunken)',
    display: 'grid', placeItems: 'center',
    color: 'var(--color-ink)',
    flexShrink: 0,
    textDecoration: 'none',
};
