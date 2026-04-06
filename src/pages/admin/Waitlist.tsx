import { useUserStore } from '../../store/userStore';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Clock, Trash2, Bell } from 'lucide-react';
import clsx from 'clsx';
import { RESOURCES } from '../../utils/data';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import type { WaitlistEntry } from '../../store/types';

export function AdminWaitlist() {
    const gridHouse = useDesignFlag();
    const { waitlist, removeFromWaitlist, users } = useUserStore();

    // Helper to get user name
    const getUserName = (userId: string) => {
        const u = users.find(u => u.email === userId);
        return u ? u.name : userId;
    };

    const handleNotify = (entryId: string) => {
        // Mock notification
        alert(`Уведомление отправлено пользователю! (ID запроса: ${entryId})`);
    };

    if (gridHouse) return (
        <GridHouseWaitlist
            waitlist={waitlist}
            getUserName={getUserName}
            handleNotify={handleNotify}
            removeFromWaitlist={removeFromWaitlist}
        />
    );

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Лист ожидания</h1>
                <p className="text-unbox-grey">Пользователи, ожидающие освобождения слотов</p>
            </div>

            <div className="bg-white rounded-xl border border-unbox-light overflow-hidden shadow-sm">
                <table className="w-full text-left">
                    <thead className="bg-unbox-light border-b border-unbox-light text-unbox-grey font-medium text-sm">
                        <tr>
                            <th className="p-4 pl-6">Дата запроса</th>
                            <th className="p-4">Клиент</th>
                            <th className="p-4">Интересующий слот</th>
                            <th className="p-4">Ресурс</th>
                            <th className="p-4 text-center">Статус</th>
                            <th className="p-4 text-right">Действия</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-unbox-light">
                        {waitlist.map(entry => {
                            const resourceName = RESOURCES.find(r => r.id === entry.resourceId)?.name || entry.resourceId;

                            return (
                                <tr key={entry.id} className="hover:bg-unbox-light/30 transition-colors">
                                    <td className="p-4 pl-6 text-unbox-grey text-sm">
                                        {format(new Date(entry.createdAt), 'dd.MM HH:mm')}
                                    </td>
                                    <td className="p-4 font-medium text-unbox-dark">
                                        {getUserName(entry.userId)}
                                        <div className="text-xs text-unbox-grey font-normal">{entry.userId}</div>
                                    </td>
                                    <td className="p-4">
                                        <div className="font-bold flex items-center gap-2 text-unbox-dark">
                                            {format(new Date(entry.date), 'dd MMMM', { locale: ru })}
                                        </div>
                                        <div className="text-sm text-unbox-grey flex items-center gap-1 mt-1">
                                            <Clock size={14} />
                                            {entry.startTime} - {entry.endTime}
                                        </div>
                                    </td>
                                    <td className="p-4 text-sm text-unbox-dark">
                                        {resourceName}
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className={clsx(
                                            "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                                            entry.status === 'active' ? "bg-unbox-light text-unbox-dark border border-unbox-green/50" : "bg-unbox-light/50 text-unbox-grey"
                                        )}>
                                            {entry.status === 'active' ? 'Ожидает' : entry.status}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button
                                                onClick={() => handleNotify(entry.id)}
                                                className="p-2 text-unbox-green hover:bg-unbox-light rounded-lg transition-colors"
                                                title="Уведомить вручную"
                                            >
                                                <Bell size={18} />
                                            </button>
                                            <button
                                                onClick={() => removeFromWaitlist(entry.id)}
                                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                title="Удалить"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>

                {waitlist.length === 0 && (
                    <div className="p-12 text-center text-unbox-grey">
                        Лист ожидания пуст
                    </div>
                )}
            </div>
        </div>
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
    removeFromWaitlist: (id: string) => Promise<void>;
}

function GridHouseWaitlist({
    waitlist,
    getUserName,
    handleNotify,
    removeFromWaitlist,
}: GHWaitlistProps) {
    const total = String(waitlist.length).padStart(3, '0');

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            {/* ── Header ── */}
            <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 28, marginBottom: 28 }}>
                <div style={{ ...ghwMono, marginBottom: 14 }}>Раздел · Лист ожидания</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
                    <h1
                        style={{
                            fontFamily: GH_SANS,
                            fontWeight: 800,
                            fontSize: 'clamp(28px, 3.5vw, 42px)',
                            lineHeight: 0.95,
                            letterSpacing: '-0.02em',
                            margin: 0,
                        }}
                    >
                        Очередь ожидания.
                    </h1>
                    <div style={{ fontFamily: GH_MONO, fontSize: 'clamp(40px, 5vw, 64px)', fontWeight: 700, lineHeight: 0.9, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
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
                            fontSize: 'clamp(28px, 3.5vw, 42px)',
                            lineHeight: 0.95,
                            letterSpacing: '-0.02em',
                            margin: 0,
                        }}
                    >
                        Никто не ждёт.
                    </h2>
                </div>
            ) : (
                <div style={{ borderTop: `2px solid ${GH.ink}` }}>
                    {/* Table head */}
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '60px 120px 1fr 1fr 160px 100px 80px',
                            gap: 16,
                            padding: '12px 0',
                            borderBottom: ghwHairline,
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
    removeFromWaitlist: (id: string) => Promise<void>;
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
