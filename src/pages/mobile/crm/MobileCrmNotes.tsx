import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, EyeOff } from 'lucide-react';
import { parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { crmApi, type CrmNote, type CrmClient } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Chip } from '../../../components/ui/Chip';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { COLOR } from '../../../design/tokens';
import { formatDayMonth, formatTime } from '../../../utils/format';

/**
 * Mobile CRM — recent notes across all clients, newest first.
 *
 * Editing / creating notes happens on the client card or in desktop CRM —
 * this view is read-mostly: a glance at "what did I write recently across
 * everyone" with a search box to find a specific note.
 *
 * Wave 1: сбой загрузки больше не выглядит как «Заметок пока нет»;
 * скелетон вместо «Загружаю…»; дата — по Батуми через format.ts.
 *
 * Волна 3 (G6-25): лента не раскрывает конфиденциальный текст целиком —
 * две строки, а «Скрывать текст» прячет его совсем (имя и дата остаются).
 * Выбор помним на этом телефоне (localStorage — удобство, не данные).
 */
const HIDE_KEY = 'unbox.mcrm.notes.hideText';

function readHide(): boolean {
    try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
}
export function MobileCrmNotes() {
    const [notes, setNotes] = useState<CrmNote[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [query, setQuery] = useState('');
    const [hideText, setHideText] = useState(readHide);
    const { clients, fetchClients } = useCrmStore();
    useDocumentTitle('Заметки · Psy-CRM');
    const toggleHide = () => {
        setHideText(v => {
            const next = !v;
            try { localStorage.setItem(HIDE_KEY, next ? '1' : '0'); } catch { /* приватный режим — просто не запомним */ }
            return next;
        });
    };

    const loadNotes = () => {
        setLoading(true);
        setFailed(false);
        crmApi.getNotes()
            .then(setNotes)
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        if (clients.length === 0) fetchClients(false).catch(() => {});
        loadNotes();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clients.length, fetchClients]);

    const clientById = useMemo(() => {
        const m = new Map<string, CrmClient>();
        for (const c of clients) m.set(c.id, c);
        return m;
    }, [clients]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const sorted = [...notes].sort((a, b) =>
            parseUTC(b.createdAt).getTime() - parseUTC(a.createdAt).getTime()
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
                <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                    Заметки
                </h1>
                <p style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                    {loading && notes.length === 0 ? 'Загружаем…' : `Всего: ${notes.length}`}
                </p>
            </div>

            <div style={{ padding: '0 16px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: 'var(--color-sunken)',
                    borderRadius: 12,
                    padding: '0 12px',
                    minHeight: 44,
                    gap: 8,
                }}>
                    <Search size={16} color={COLOR.ink60} aria-hidden="true" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        aria-label="Поиск по тексту или имени клиента"
                        placeholder="Поиск по тексту или имени клиента"
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            fontSize: 16,
                            fontFamily: 'inherit',
                            minWidth: 0,
                            color: 'var(--color-ink)',
                        }}
                    />
                </div>
                <Chip
                    selected={hideText}
                    onClick={toggleHide}
                    icon={<EyeOff size={16} aria-hidden="true" />}
                    style={{ marginTop: 8 }}
                >
                    Скрывать текст
                </Chip>
            </div>

            {failed && !loading && (
                <div style={{ padding: '0 16px' }}>
                    <ErrorBar message="Не удалось загрузить заметки" onRetry={loadNotes} />
                </div>
            )}

            {loading && notes.length === 0 && (
                <div style={{ padding: '0 16px' }}>
                    <SkeletonList count={4} label="Загружаем заметки" cardHeight={88} />
                </div>
            )}

            {!loading && !failed && filtered.length === 0 && (
                <div style={{ padding: '0 16px' }}>
                    {query ? (
                        <EmptyState compact title="Ничего не нашлось" hint="Попробуйте другое слово или имя." />
                    ) : (
                        <EmptyState compact title="Заметок пока нет" hint="Заметку можно добавить в шторке сессии или в карточке клиента («+ Заметка»)." />
                    )}
                </div>
            )}

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map(n => {
                    const c = clientById.get(n.clientId);
                    const created = parseUTC(n.createdAt);
                    return (
                        <Link
                            key={n.id}
                            to={c ? `/m/crm/clients/${c.id}` : '/m/crm/clients'}
                            style={{
                                background: 'var(--color-card)',
                                border: '1px solid var(--color-ink-08)',
                                borderRadius: 12,
                                padding: '12px 14px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                color: 'var(--color-ink)',
                                textDecoration: 'none',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontSize: 14, fontWeight: 600 }}>
                                    {c?.name ?? '—'}
                                </span>
                                <span style={{ fontSize: 12, color: 'var(--color-ink-60)', whiteSpace: 'nowrap' }}>
                                    {formatDayMonth(created, { timeZone: BATUMI_TZ })}, {formatTime(created, { timeZone: BATUMI_TZ })}
                                </span>
                            </div>
                            {hideText ? (
                                <div style={{ fontSize: 14, color: 'var(--color-ink-60)' }}>
                                    Текст скрыт — откройте карточку клиента
                                </div>
                            ) : (
                                <div style={{
                                    fontSize: 14,
                                    color: 'var(--color-ink-80)',
                                    lineHeight: 1.4,
                                    overflow: 'hidden',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                }}>
                                    {n.content}
                                </div>
                            )}
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
