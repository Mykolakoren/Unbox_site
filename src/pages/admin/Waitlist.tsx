import { useState, useEffect } from 'react';
import { useUserStore } from '../../store/userStore';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Clock, Trash2, Bell } from 'lucide-react';
import clsx from 'clsx';
import { RESOURCES } from '../../utils/data';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import type { WaitlistEntry } from '../../store/types';
import { toast } from 'sonner';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { waitlistApi } from '../../api/waitlist';

export function AdminWaitlist() {
        const { waitlist, removeFromWaitlist, users } = useUserStore();

    const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; entryId: string }>({ open: false, entryId: '' });

    // Helper to get user name
    const getUserName = (userId: string) => {
        const u = users.find(u => u.email === userId);
        return u ? u.name : userId;
    };

    const handleNotify = async (entryId: string) => {
        try {
            const r = await waitlistApi.notifyEntry(entryId);
            toast.success(`Уведомление отправлено${r.notified ? ` — ${r.notified}` : ''}`);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось отправить уведомление');
        }
    };

    const handleDeleteRequest = (entryId: string) => {
        setDeleteConfirm({ open: true, entryId });
    };

    const handleDeleteConfirm = () => {
        removeFromWaitlist(deleteConfirm.entryId);
        toast.success('Запись удалена из листа ожидания');
    };

    const deleteModal = (
        <ConfirmationModal
            isOpen={deleteConfirm.open}
            onClose={() => setDeleteConfirm({ open: false, entryId: '' })}
            onConfirm={handleDeleteConfirm}
            title="Удалить из листа ожидания"
            message="Вы уверены? Эту запись нельзя будет восстановить."
            isDestructive
            confirmLabel="Удалить"
        />
    );

    return (

        <>
            {deleteModal}
            <GridHouseWaitlist
                waitlist={waitlist}
                getUserName={getUserName}
                handleNotify={handleNotify}
                removeFromWaitlist={handleDeleteRequest}
            />
        </>
    );
}


// ═════════════════════════════════════════════════════════════════════════
// GRID HOUSE VARIANT
// Rollback: delete everything below + the early-return block above.
// ═════════════════════════════════════════════════════════════════════════

const ghwHairline = `1px solid ${GH.ink10}`;
const ghwMono: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: GH.ink60,
};

interface GHWaitlistProps {
    waitlist: WaitlistEntry[];
    getUserName: (userId: string) => string;
    handleNotify: (entryId: string) => void;
    removeFromWaitlist: (id: string) => void | Promise<void>;
}

function GridHouseWaitlist({
    waitlist,
    getUserName,
    handleNotify,
    removeFromWaitlist,
}: GHWaitlistProps) {
    const total = String(waitlist.length).padStart(3, '0');
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 768);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            {/* ── Header ── */}
            <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: narrow ? 16 : 28, marginBottom: narrow ? 16 : 28 }}>
                <div style={{ ...ghwMono, marginBottom: narrow ? 8 : 14 }}>Раздел · Лист ожидания</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: narrow ? 12 : 20 }}>
                    <h1
                        style={{
                            fontFamily: GH_SANS,
                            fontWeight: 800,
                            fontSize: narrow ? 24 : 'clamp(28px, 3.5vw, 42px)',
                            lineHeight: 0.95,
                            letterSpacing: '-0.02em',
                            margin: 0,
                        }}
                    >
                        Очередь ожидания.
                    </h1>
                    <div style={{ fontFamily: GH_MONO, fontSize: narrow ? 36 : 'clamp(40px, 5vw, 64px)', fontWeight: 700, lineHeight: 0.9, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                        {total}
                    </div>
                </div>
                <div style={{ ...ghwMono, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                    Всего в очереди
                </div>
            </div>

            {waitlist.length === 0 ? (
                <div style={{ borderTop: `2px solid ${GH.ink}`, borderBottom: ghwHairline, padding: '80px 24px', textAlign: 'center' }}>
                    <div style={{ ...ghwMono, marginBottom: 14 }}>→ Пустая очередь</div>
                    <h2
                        style={{
                            fontFamily: GH_SANS,
                            fontWeight: 800,
                            fontSize: narrow ? 24 : 'clamp(28px, 3.5vw, 42px)',
                            lineHeight: 0.95,
                            letterSpacing: '-0.02em',
                            margin: 0,
                        }}
                    >
                        Никто не ждёт.
                    </h2>
                </div>
            ) : narrow ? (
                /* ── Mobile card list ── */
                <div style={{ borderTop: `2px solid ${GH.ink}` }}>
                    {waitlist.map((entry, idx) => {
                        const resourceName = RESOURCES.find((r) => r.id === entry.resourceId)?.name || entry.resourceId;
                        return (
                            <div
                                key={entry.id}
                                style={{
                                    padding: '14px 0',
                                    borderBottom: ghwHairline,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 6,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                        <span style={{ fontFamily: GH_MONO, fontSize: 10, color: GH.ink30, fontVariantNumeric: 'tabular-nums' }}>
                                            {String(idx + 1).padStart(3, '0')}
                                        </span>
                                        <span style={{
                                            fontSize: 14, fontWeight: 700, color: GH.ink, letterSpacing: '-0.005em',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                                        }}>
                                            {getUserName(entry.userId)}
                                        </span>
                                    </div>
                                    <span style={{
                                        fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.12em',
                                        textTransform: 'uppercase' as const, padding: '3px 7px',
                                        border: `1px solid ${entry.status === 'active' ? GH.ink : GH.ink30}`,
                                        color: entry.status === 'active' ? GH.ink : GH.ink60,
                                        whiteSpace: 'nowrap' as const,
                                    }}>
                                        {entry.status === 'active' ? 'Ожидает' : entry.status}
                                    </span>
                                </div>
                                <div style={{ ...ghwMono, color: GH.ink60, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                        {format(new Date(entry.date), 'dd MMM', { locale: ru })}
                                    </span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontVariantNumeric: 'tabular-nums' }}>
                                        <Clock size={10} /> {entry.startTime}–{entry.endTime}
                                    </span>
                                    <span>{resourceName}</span>
                                </div>
                                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                    <button
                                        onClick={() => handleNotify(entry.id)}
                                        style={{
                                            fontFamily: GH_MONO, fontSize: 9, fontWeight: 600,
                                            letterSpacing: '0.12em', textTransform: 'uppercase' as const,
                                            padding: '6px 10px', background: 'transparent', color: GH.ink,
                                            border: `1px solid ${GH.ink10}`, cursor: 'pointer',
                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                        }}
                                    >
                                        <Bell size={10} /> Уведомить
                                    </button>
                                    <button
                                        onClick={() => removeFromWaitlist(entry.id)}
                                        style={{
                                            fontFamily: GH_MONO, fontSize: 9, fontWeight: 600,
                                            letterSpacing: '0.12em', textTransform: 'uppercase' as const,
                                            padding: '6px 10px', background: 'transparent', color: GH.danger,
                                            border: `1px solid ${GH.danger}40`, cursor: 'pointer',
                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                        }}
                                    >
                                        <Trash2 size={10} /> Удалить
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div style={{ borderTop: `2px solid ${GH.ink}`, overflowX: 'auto' }}>
                    {/* Table head */}
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '60px 120px 1fr 1fr 160px 100px 80px',
                            gap: 16,
                            padding: '12px 0',
                            borderBottom: ghwHairline,
                            minWidth: 720,
                            ...ghwMono,
                        }}
                    >
                        <div>#</div>
                        <div>Запрос</div>
                        <div>Клиент</div>
                        <div>Слот</div>
                        <div>Ресурс</div>
                        <div style={{ textAlign: 'center' }}>Статус</div>
                        <div style={{ textAlign: 'right' }}>→</div>
                    </div>

                    {waitlist.map((entry, idx) => (
                        <GHWRow
                            key={entry.id}
                            entry={entry}
                            index={idx}
                            getUserName={getUserName}
                            handleNotify={handleNotify}
                            removeFromWaitlist={removeFromWaitlist}
                        />
                    ))}
                </div>
            )}

            {/* ── Footer ── */}
            <div style={{ borderTop: `2px solid ${GH.ink}`, marginTop: 48, paddingTop: 16 }}>
                <p style={{ ...ghwMono, color: GH.ink30, margin: 0 }}>UNBOX ADMIN · 2026</p>
            </div>
        </div>
    );
}

function GHWRow({
    entry,
    index,
    getUserName,
    handleNotify,
    removeFromWaitlist,
}: {
    entry: WaitlistEntry;
    index: number;
    getUserName: (userId: string) => string;
    handleNotify: (entryId: string) => void;
    removeFromWaitlist: (id: string) => void | Promise<void>;
}) {
    const resourceName = RESOURCES.find((r) => r.id === entry.resourceId)?.name || entry.resourceId;

    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: '60px 120px 1fr 1fr 160px 100px 80px',
                gap: 16,
                padding: '18px 0',
                borderBottom: ghwHairline,
                alignItems: 'center',
                minWidth: 720,
            }}
        >
            <div
                style={{
                    fontFamily: GH_MONO,
                    fontSize: 11,
                    letterSpacing: '0.1em',
                    color: GH.ink60,
                    fontVariantNumeric: 'tabular-nums',
                }}
            >
                {String(index + 1).padStart(3, '0')}
            </div>
            <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60, fontVariantNumeric: 'tabular-nums' }}>
                {format(new Date(entry.createdAt), 'dd.MM · HH:mm')}
            </div>
            <div>
                <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
                    {getUserName(entry.userId)}
                </div>
                <div style={{ ...ghwMono, color: GH.ink30, marginTop: 2 }}>{entry.userId}</div>
            </div>
            <div>
                <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.005em' }}>
                    {format(new Date(entry.date), 'dd MMMM', { locale: ru })}
                </div>
                <div style={{ ...ghwMono, color: GH.ink60, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
                    <Clock size={11} /> {entry.startTime}–{entry.endTime}
                </div>
            </div>
            <div style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.05em', color: GH.ink }}>
                {resourceName}
            </div>
            <div style={{ textAlign: 'center' }}>
                <span
                    style={{
                        display: 'inline-block',
                        fontFamily: GH_MONO,
                        fontSize: 10,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        padding: '4px 10px',
                        border: `1px solid ${entry.status === 'active' ? GH.ink : GH.ink30}`,
                        color: entry.status === 'active' ? GH.ink : GH.ink60,
                        background: entry.status === 'active' ? GH.paper : 'transparent',
                    }}
                >
                    {entry.status === 'active' ? 'Ожидает' : entry.status}
                </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <GHWIconButton onClick={() => handleNotify(entry.id)} title="Уведомить">
                    <Bell size={13} />
                </GHWIconButton>
                <GHWIconButton onClick={() => removeFromWaitlist(entry.id)} title="Удалить" danger>
                    <Trash2 size={13} />
                </GHWIconButton>
            </div>
        </div>
    );
}

function GHWIconButton({
    onClick,
    title,
    danger,
    children,
}: {
    onClick: () => void;
    title: string;
    danger?: boolean;
    children: React.ReactNode;
}) {
    const hoverBorder = danger ? GH.danger : GH.ink;
    const hoverColor = danger ? GH.danger : GH.ink;

    return (
        <button
            onClick={onClick}
            title={title}
            style={{
                width: 32,
                height: 32,
                background: 'transparent',
                border: `1px solid ${GH.ink10}`,
                cursor: 'pointer',
                color: GH.ink60,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = hoverBorder; e.currentTarget.style.color = hoverColor; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = GH.ink10; e.currentTarget.style.color = GH.ink60; }}
        >
            {children}
        </button>
    );
}
