import { useEffect, useMemo, useState } from 'react';
import { Search, ShieldCheck, ShieldX, GripVertical, Clock, Star } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Segmented } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { COLOR } from '../../../design/tokens';
import { DesktopLink } from './DesktopLink';
import { ADMIN_REQUESTS_CHANGED } from './sheetLayers';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { toastApiError } from '../../../utils/errors';
import { ListGroup, ListRow, ListAvatar } from '../../../components/ui/ListRow';
import { Counter } from '../../../components/ui/Counter';

interface SpecialistRow {
    id: string;
    firstName: string;
    lastName: string;
    photoUrl: string | null;
    tagline: string;
    isVerified: boolean;
    applicationStatus: string | null;
    category: string | null;
    sortOrder: number;
    isOwner: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
    psychology:  'Психология',
    psychiatry:  'Психиатрия',
    narcology:   'Наркология',
    coaching:    'Коучинг',
    education:   'Обучение',
};

/**
 * Mobile admin: Специалисты — searchable list with quick verify/unverify.
 * Drag-to-reorder + photo upload + bio editing stays on desktop (better
 * mouse precision); this screen is meant for the on-call admin who needs
 * to quickly approve a freshly-submitted application or hide a card.
 *
 * Wave 1: общие Segmented/Button, эмодзи ⏳ → значок, кнопки 44 px;
 * «Открыть» → «Опубликовать» (что именно произойдёт).
 */
export function MobileAdminSpecialists() {
    const [rows, setRows] = useState<SpecialistRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [q, setQ] = useState('');
    // ?filter=pending — из «Заявок» («Специалисты на проверке»).
    const [filter, setFilter] = useState<'all' | 'pending' | 'verified'>(
        () => (new URLSearchParams(window.location.search).get('filter') === 'pending' ? 'pending' : 'all'),
    );
    const [failed, setFailed] = useState(false);
    const { confirm } = useConfirmDialog();

    const load = async () => {
        setLoading(true);
        try {
            const { data } = await api.get<SpecialistRow[]>('/specialists/admin/all');
            setRows(data);
            setFailed(false);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return rows
            .filter(r => {
                if (filter === 'pending' && r.applicationStatus !== 'pending') return false;
                if (filter === 'verified' && !r.isVerified) return false;
                if (needle) {
                    const hay = `${r.firstName} ${r.lastName} ${r.tagline}`.toLowerCase();
                    if (!hay.includes(needle)) return false;
                }
                return true;
            })
            .sort((a, b) => {
                if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
                if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
                return (a.sortOrder ?? 99) - (b.sortOrder ?? 99);
            });
    }, [rows, q, filter]);

    const handleVerify = async (r: SpecialistRow, next: boolean) => {
        // Волна 4 (G9-09): публикация новой анкеты (одобрение заявки) и скрытие
        // с сайта — с вопросом. Повторное открытие уже проверенной — сразу.
        const approving = next && r.applicationStatus === 'pending';
        if (!next || approving) {
            const name = `${r.firstName} ${r.lastName}`.trim();
            const ok = await confirm({ ...(approving ? {
                title: `Опубликовать анкету «${name}»?`,
                body: 'Заявка будет одобрена, анкета появится в каталоге на сайте. Проверили документы и текст?',
                confirmLabel: 'Одобрить и опубликовать',
                cancelLabel: 'Ещё не проверено',
            } : {
                title: `Скрыть «${name}» с сайта?`,
                body: 'Анкета пропадёт из каталога специалистов. Вернуть можно кнопкой «Опубликовать».',
                confirmLabel: 'Скрыть с сайта',
                cancelLabel: 'Оставить',
                tone: 'danger' as const,
            }) });
            if (!ok) return;
        }
        setBusyId(r.id);
        try {
            const endpoint = r.applicationStatus === 'pending' && next
                ? `/specialists/admin/${r.id}/approve`
                : `/specialists/admin/${r.id}`;
            const method = r.applicationStatus === 'pending' && next ? 'post' : 'patch';
            const body = r.applicationStatus === 'pending' && next
                ? undefined
                : { is_verified: next };
            await (api as any)[method](endpoint, body);
            await load();
            window.dispatchEvent(new Event(ADMIN_REQUESTS_CHANGED));
            toast.success(next ? 'Анкета опубликована' : 'Анкета скрыта с сайта');
        } catch (e: any) {
            toastApiError(e, 'Не удалось изменить анкету. Попробуйте ещё раз');
        } finally {
            setBusyId(null);
        }
    };

    const pendingCount = rows.filter(r => r.applicationStatus === 'pending').length;

    return (
        // 09.11 фаза 3: шапка во всю ширину, строки — ListRow, действие — тихая кнопка sm.
        <div style={{ paddingBottom: 90 }}>
            <MobilePageHeader
                title="Специалисты"
                subtitle={loading ? undefined : `Анкет: ${rows.length}${pendingCount > 0 ? ` · на проверке ${pendingCount}` : ''}`}
                fallbackTo="/m/admin/dashboard"
            />
            <div style={{ padding: '16px 16px 0' }}>
            {pendingCount > 0 && filter !== 'pending' && (
                <button
                    onClick={() => setFilter('pending')}
                    style={{
                        width: '100%',
                        marginBottom: 12,
                        padding: '10px 12px',
                        background: 'var(--status-pending-bg)',
                        color: 'var(--status-pending-fg)',
                        border: 'none',
                        borderRadius: 8,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        minHeight: 44,
                    }}
                >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Clock size={16} aria-hidden="true" /> Анкеты ждут проверки
                    </span>
                    {/* Один вид счётчика во всей админке (admin-design №14). */}
                    <Counter value={pendingCount} style={{ boxShadow: 'none' }} />
                </button>
            )}

            <div style={{ position: 'relative', marginBottom: 10 }}>
                <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 12, top: 14, color: COLOR.ink60 }} />
                <input
                    type="text"
                    aria-label="Поиск специалиста"
                    placeholder="Имя или слоган"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    style={{
                        width: '100%',
                        minHeight: 44,
                        padding: '10px 12px 10px 36px',
                        border: 'none',
                        borderRadius: 8,
                        fontSize: 16,
                        // Поле поиска — как на остальных экранах: sunken, без рамки.
                        background: 'var(--color-sunken)',
                        color: 'var(--color-ink)',
                        outline: 'none',
                    }}
                />
            </div>

            <Segmented<'all' | 'pending' | 'verified'>
                aria-label="Какие анкеты показать"
                className="mb-3"
                options={[
                    { value: 'all', label: 'Все' },
                    { value: 'verified', label: 'Опубликованы' },
                    { value: 'pending', label: 'На проверке' },
                ]}
                value={filter}
                onChange={setFilter}
            />

            {failed && !loading && (
                <ErrorBar message="Не удалось загрузить специалистов" onRetry={load} className="mb-3" />
            )}
            {loading ? (
                <SkeletonList count={5} label="Загружаем специалистов" cardHeight={60} />
            ) : failed ? null : filtered.length === 0 ? (
                <EmptyState compact title="Ничего не найдено" hint={q ? 'Попробуйте другое имя.' : undefined} />
            ) : (
                <ListGroup aria-label="Специалисты">
                    {filtered.map(r => {
                        const name = `${r.firstName} ${r.lastName}`.trim();
                        return (
                            <ListRow
                                key={r.id}
                                lead={<ListAvatar name={name} src={r.photoUrl} />}
                                title={<>
                                    {name}
                                    {r.isOwner && <Star size={12} aria-label="Владелец" style={{ display: 'inline-block', marginLeft: 4, color: 'var(--color-ink-60)', verticalAlign: '-1px' }} />}
                                </>}
                                subtitle={CATEGORY_LABEL[r.category || ''] || 'Направление не указано'}
                                // Состояние — своей строкой, чтобы не обрезалось (ревью 09.11, №23).
                                // «На сайте» — обычное состояние, плашку не рисуем; отличаются
                                // только «Ждёт проверки» и скрытые (бледнее).
                                meta={r.applicationStatus === 'pending'
                                    ? <span className="ui-badge ui-badge--pending">Ждёт проверки</span>
                                    : r.isVerified
                                        ? undefined
                                        : <span className="ui-badge ui-badge--muted">Скрыт с сайта</span>}
                                dimmed={!r.isVerified && r.applicationStatus !== 'pending'}
                                action={
                                    <Button
                                        variant="quiet"
                                        size="sm"
                                        loading={busyId === r.id}
                                        icon={r.isVerified ? <ShieldX size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
                                        onClick={() => handleVerify(r, !r.isVerified)}
                                        aria-label={`${r.isVerified ? 'Скрыть с сайта' : 'Опубликовать'}: ${r.firstName} ${r.lastName}`}
                                        title={r.isVerified ? 'Скрыть с сайта' : 'Опубликовать на сайте'}
                                    >
                                        {r.isVerified ? 'Скрыть' : 'Показать'}
                                    </Button>
                                }
                            />
                        );
                    })}
                </ListGroup>
            )}

            <div style={{
                marginTop: 16,
                padding: 12,
                background: 'var(--color-sunken)',
                borderRadius: 16,
                fontSize: 14,
                color: 'var(--color-ink-80)',
                lineHeight: 1.5,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
            }}>
                <GripVertical size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-ink-60)' }} />
                <span>
                    Порядок карточек, фото и текст анкеты удобнее менять в полной версии.
                    <br />
                    <DesktopLink href="/admin/specialists">Открыть полную версию →</DesktopLink>
                </span>
            </div>
            </div>
        </div>
    );
}
