import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, FileText } from 'lucide-react';
import { parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { crmApi, type CrmNote, type CrmClient } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Button } from '../../../components/ui/Button';
import { ListGroup, ListIcon, ListRow } from '../../../components/ui/ListRow';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { CrmSearch } from './CrmSearch';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { formatDayMonth, formatTime } from '../../../utils/format';
import { useNotesHidden } from './notesPrivacy';

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
 * 09.11 (ревью п. 10): «Скрывать текст» — общая настройка всей мобильной CRM
 * (notesPrivacy.ts), по умолчанию ВКЛЮЧЕНА; действует и в карточке клиента,
 * и в шторке сессии.
 */
export function MobileCrmNotes() {
    const [notes, setNotes] = useState<CrmNote[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [query, setQuery] = useState('');
    const [hideText, toggleHide] = useNotesHidden();
    const { clients, fetchClients } = useCrmStore();
    useDocumentTitle('Заметки · Psy-CRM');

    const loadNotes = () => {
        setLoading(true);
        setFailed(false);
        crmApi.getNotes()
            .then(setNotes)
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        // 06.11: клиентов грузим всегда, не только при пустом списке — синк календаря
        // мог завести новую карточку, а в памяти страницы её нет (встреча «без имени»).
        fetchClients(false).catch(() => {});
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
        <div style={{ paddingBottom: 24, display: 'flex', flexDirection: 'column' }}>
            {/* 09.11 фаза 3: общая крупная шапка; число — только при поиске. */}
            <MobilePageHeader
                variant="large"
                title="Заметки"
                subtitle={loading && notes.length === 0 ? 'Загружаем…' : query.trim() ? `Найдено: ${filtered.length}` : undefined}
            />

            <div style={{ padding: '0 16px' }}>
                {/* Дизайн-ревью п. 16, 23: поиск — общий вид; «Скрывать текст» — глаз 44×44
                    в строке поиска, состояние — значком, подписью и aria-pressed. */}
                <CrmSearch
                    value={query}
                    onChange={setQuery}
                    label="Поиск по тексту или имени клиента"
                    placeholder="Текст или имя клиента"
                    trailing={(
                        <Button
                            variant="secondary"
                            aria-pressed={hideText}
                            aria-label={hideText ? 'Текст скрыт · показать' : 'Скрыть текст'}
                            title={hideText ? 'Текст скрыт · показать' : 'Скрыть текст'}
                            onClick={toggleHide}
                            icon={hideText ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                            style={hideText ? { background: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)', color: 'var(--color-accent-ink)' } : undefined}
                        />
                    )}
                />
                <div style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 8, padding: '0 4px' }}>
                    {hideText ? 'Текст заметок скрыт — видны только имя и дата' : 'Текст заметок виден'}
                </div>
            </div>

            <div style={{ padding: '24px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {failed && !loading && (
                <ErrorBar message="Не удалось загрузить заметки" onRetry={loadNotes} />
            )}

            {loading && notes.length === 0 && (
                <SkeletonList count={4} label="Загружаем заметки" cardHeight={88} />
            )}

            {!loading && !failed && filtered.length === 0 && (
                query ? (
                    <EmptyState compact title="Ничего не нашлось" hint="Попробуйте другое слово или имя." />
                ) : (
                    <EmptyState compact title="Заметок пока нет" hint="Заметку можно добавить в шторке сессии или в карточке клиента («+ Заметка»)." />
                )
            )}

            {filtered.length > 0 && (
                <ListGroup aria-label="Заметки">
                    {filtered.map(n => {
                        const c = clientById.get(n.clientId);
                        const created = parseUTC(n.createdAt);
                        return (
                            <ListRow
                                key={n.id}
                                to={c ? `/m/crm/clients/${c.id}` : '/m/crm/clients'}
                                lead={<ListIcon><FileText size={20} /></ListIcon>}
                                title={c?.name ?? '—'}
                                subtitle={hideText ? 'Текст скрыт' : (
                                    <span style={{
                                        color: 'var(--color-ink-80)', overflow: 'hidden',
                                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                    }}>
                                        {n.content}
                                    </span>
                                )}
                                trail={<span style={{ color: 'var(--color-ink-60)', fontWeight: 500 }} className="num">{formatDayMonth(created, { timeZone: BATUMI_TZ })}</span>}
                                trailSub={<span className="num">{formatTime(created, { timeZone: BATUMI_TZ })}</span>}
                            />
                        );
                    })}
                </ListGroup>
            )}
            </div>
        </div>
    );
}
