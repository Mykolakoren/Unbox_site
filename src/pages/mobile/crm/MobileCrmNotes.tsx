import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ru } from 'date-fns/locale';
import { Search } from 'lucide-react';
import { formatBatumi } from '../../../utils/dateUtils';
import { crmApi, type CrmNote, type CrmClient } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';

/**
 * Mobile CRM — recent notes across all clients, newest first.
 *
 * Editing / creating notes happens on the client card or in desktop CRM —
 * this view is read-mostly: a glance at "what did I write recently across
 * everyone" with a search box to find a specific note.
 */
export function MobileCrmNotes() {
    const [notes, setNotes] = useState<CrmNote[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const { clients, fetchClients } = useCrmStore();

    useEffect(() => {
        if (clients.length === 0) fetchClients(false).catch(() => {});
        crmApi.getNotes()
            .then(setNotes)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [clients.length, fetchClients]);

    const clientById = useMemo(() => {
        const m = new Map<string, CrmClient>();
        for (const c of clients) m.set(c.id, c);
        return m;
    }, [clients]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const sorted = [...notes].sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        if (!q) return sorted;
        return sorted.filter(n => {
            const c = clientById.get(n.clientId);
            return (n.content || '').toLowerCase().includes(q)
                || (c?.name || '').toLowerCase().includes(q);
        });
    }, [notes, query, clientById]);

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                    Заметки
                </h1>
                <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    Всего: {notes.length}
                </p>
            </div>

            <div style={{ padding: '0 16px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#F4F4F2',
                    borderRadius: 12,
                    padding: '10px 12px',
                    gap: 8,
                }}>
                    <Search size={16} color="#999" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Поиск по тексту или имени клиента"
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            fontSize: 14,
                            fontFamily: 'inherit',
                            minWidth: 0,
                        }}
                    />
                </div>
            </div>

            {loading && <div style={{ padding: '0 16px', color: '#666', fontSize: 14 }}>Загружаю…</div>}

            {!loading && filtered.length === 0 && (
                <div style={{ padding: '0 16px' }}>
                    <div style={{
                        background: '#F4F4F2',
                        borderRadius: 14,
                        padding: 20,
                        textAlign: 'center',
                        color: '#666',
                        fontSize: 14,
                    }}>
                        {query ? 'Ничего не нашлось' : 'Заметок пока нет.'}
                    </div>
                </div>
            )}

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map(n => {
                    const c = clientById.get(n.clientId);
                    return (
                        <Link
                            key={n.id}
                            to={c ? `/m/crm/clients/${c.id}` : '/m/crm/clients'}
                            style={{
                                background: '#fff',
                                border: '1px solid rgba(0,0,0,0.08)',
                                borderRadius: 12,
                                padding: '12px 14px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                color: '#0E0E0E',
                                textDecoration: 'none',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 700 }}>
                                    {c?.name ?? '—'}
                                </span>
                                <span style={{ fontSize: 11, color: '#999' }}>
                                    {formatBatumi(n.createdAt, 'd MMM, HH:mm', ru)}
                                </span>
                            </div>
                            <div style={{
                                fontSize: 13,
                                color: '#444',
                                lineHeight: 1.4,
                                overflow: 'hidden',
                                display: '-webkit-box',
                                WebkitLineClamp: 4,
                                WebkitBoxOrient: 'vertical',
                            }}>
                                {n.content}
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
