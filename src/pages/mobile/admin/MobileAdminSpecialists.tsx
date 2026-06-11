import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, ShieldCheck, ShieldX, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../api/client';

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
 */
export function MobileAdminSpecialists() {
    const [rows, setRows] = useState<SpecialistRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [q, setQ] = useState('');
    const [filter, setFilter] = useState<'all' | 'pending' | 'verified'>('all');

    const load = async () => {
        setLoading(true);
        try {
            const { data } = await api.get<SpecialistRow[]>('/specialists/admin/all');
            setRows(data);
        } catch {
            toast.error('Не удалось загрузить специалистов');
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
            toast.success(next ? 'Опубликован' : 'Скрыт');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Ошибка');
        } finally {
            setBusyId(null);
        }
    };

    const pendingCount = rows.filter(r => r.applicationStatus === 'pending').length;

    return (
        <div style={{ padding: '14px 14px 90px' }}>
            {pendingCount > 0 && filter !== 'pending' && (
                <button
                    onClick={() => setFilter('pending')}
                    style={{
                        width: '100%',
                        marginBottom: 12,
                        padding: '10px 12px',
                        background: '#FEF3C7',
                        color: '#92400E',
                        border: 'none',
                        borderRadius: 10,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <span>⏳ Заявки на верификацию</span>
                    <span style={{
                        background: '#92400E',
                        color: '#fff',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 12,
                    }}>{pendingCount}</span>
                </button>
            )}

            <div style={{ position: 'relative', marginBottom: 10 }}>
                <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: '#888' }} />
                <input
                    type="text"
                    placeholder="Поиск по имени или таглайну"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '9px 12px 9px 32px',
                        border: '1px solid rgba(0,0,0,0.1)',
                        borderRadius: 9,
                        fontSize: 13,
                        outline: 'none',
                    }}
                />
            </div>

            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                {([
                    { id: 'all', label: 'Все' },
                    { id: 'verified', label: 'Опубликованы' },
                    { id: 'pending', label: 'На проверке' },
                ] as const).map(f => (
                    <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        style={{
                            flex: 1,
                            padding: '7px 0',
                            background: filter === f.id ? '#0E0E0E' : 'rgba(0,0,0,0.04)',
                            color: filter === f.id ? '#fff' : '#0E0E0E',
                            border: 'none',
                            borderRadius: 8,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                    <Loader2 size={20} className="animate-spin" style={{ color: '#888' }} />
                </div>
            ) : filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#888', fontSize: 13 }}>
                    Ничего не найдено
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {filtered.map(r => (
                        <div key={r.id} style={{
                            background: '#fff',
                            border: '1px solid rgba(0,0,0,0.06)',
                            borderRadius: 11,
                            padding: '10px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            opacity: r.isVerified ? 1 : 0.55,
                        }}>
                            {r.photoUrl ? (
                                <img
                                    src={r.photoUrl}
                                    alt={r.firstName}
                                    style={{
                                        width: 36, height: 36,
                                        borderRadius: 9,
                                        objectFit: 'cover',
                                        flexShrink: 0,
                                    }}
                                />
                            ) : (
                                <div style={{
                                    width: 36, height: 36, borderRadius: 9,
                                    background: 'rgba(0,0,0,0.06)',
                                    color: '#888',
                                    display: 'grid', placeItems: 'center',
                                    fontSize: 12, fontWeight: 700,
                                    flexShrink: 0,
                                }}>
                                    {r.firstName[0]?.toUpperCase()}{r.lastName[0]?.toUpperCase()}
                                </div>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontWeight: 600, fontSize: 13, color: '#0E0E0E',
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}>
                                    {r.firstName} {r.lastName}
                                    {r.isOwner && <span style={{ marginLeft: 4, color: '#1B7430' }}>★</span>}
                                </div>
                                <div style={{
                                    fontSize: 10, color: '#888',
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    marginTop: 1,
                                }}>
                                    {CATEGORY_LABEL[r.category || ''] || '—'}
                                    {r.applicationStatus === 'pending' && (
                                        <span style={{ marginLeft: 6, color: '#92400E', fontWeight: 700 }}>· на проверке</span>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => handleVerify(r, !r.isVerified)}
                                disabled={busyId === r.id}
                                style={{
                                    background: r.isVerified ? 'rgba(0,0,0,0.05)' : '#1B7430',
                                    color: r.isVerified ? '#0E0E0E' : '#fff',
                                    border: 'none',
                                    borderRadius: 7,
                                    padding: '6px 9px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    flexShrink: 0,
                                }}
                            >
                                {busyId === r.id ? <Loader2 size={11} className="animate-spin" />
                                    : r.isVerified ? <ShieldX size={11} /> : <ShieldCheck size={11} />}
                                {r.isVerified ? 'Скрыть' : 'Открыть'}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div style={{
                marginTop: 16,
                padding: 12,
                background: 'rgba(76,138,107,0.06)',
                borderRadius: 10,
                fontSize: 12,
                color: '#444',
                lineHeight: 1.5,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
            }}>
                <GripVertical size={14} style={{ flexShrink: 0, marginTop: 2, color: '#1B7430' }} />
                <span>
                    Drag-and-drop порядка карточек, загрузка фото и редактирование анкеты — в десктоп-версии /admin/specialists.
                </span>
            </div>
        </div>
    );
}
