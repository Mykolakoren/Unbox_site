import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useUserStore } from '../../../store/userStore';
import type { User } from '../../../store/types';
import { Sheet } from '../../../components/ui/Sheet';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatGel } from '../../../utils/format';
import { COLOR } from '../../../design/tokens';
import { matchesPerson } from './searchMatch';

/**
 * «Кто платит?» — найти клиента, чтобы деньги легли на его баланс
 * (ревью 09.11, admin-ux №13). Открывается из «Кассы» → «Новая операция» →
 * «Доход»: оплата клиента, записанная простым доходом, оставляла долг, и
 * следующий админ брал деньги второй раз. Выбрали клиента — дальше обычная
 * шторка «Пополнить баланс» (TopupSheet: защита от дубля, «Вернуть» 5 с).
 */
export function ClientPickSheet({ onClose, onPick }: {
    onClose: () => void;
    onPick: (u: User) => void;
}) {
    const { users, fetchUsers } = useUserStore();
    const [query, setQuery] = useState('');
    useEffect(() => {
        if (!users || users.length === 0) fetchUsers().catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const found = useMemo(() => {
        const q = query.trim();
        if (!q) return [];
        return (users || [])
            .filter(u => matchesPerson(q, { name: u.name, email: u.email, phone: u.phone }))
            .slice(0, 20);
    }, [users, query]);
    return (
        <Sheet open onClose={onClose} title="Кто платит?" description="Найдите клиента — деньги лягут на его баланс и закроют долг.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{
                    display: 'flex', alignItems: 'center', background: 'var(--color-sunken)',
                    borderRadius: 12, padding: '0 12px', minHeight: 44, gap: 8,
                }}>
                    <Search size={16} color={COLOR.ink60} aria-hidden="true" />
                    <input
                        autoFocus
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        aria-label="Имя или телефон клиента"
                        placeholder="Имя, телефон, email…"
                        style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 16, fontFamily: 'inherit', minWidth: 0, color: 'var(--color-ink)' }}
                    />
                </div>
                {query.trim() && found.length === 0 && (
                    <EmptyState compact title="Никого не нашлось" hint="Попробуйте другое имя или номер." />
                )}
                {found.map(u => {
                    const bal = Number(u.balance ?? 0);
                    return (
                        <button
                            key={u.id || u.email}
                            type="button"
                            onClick={() => onPick(u)}
                            className="press"
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '8px 12px',
                                borderRadius: 12, border: '1px solid var(--color-ink-08)', background: 'var(--color-card)',
                                fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'var(--color-ink)',
                            }}
                        >
                            <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: 'block', fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || u.email}</span>
                                <span style={{ display: 'block', fontSize: 12, color: 'var(--color-ink-60)' }}>{u.phone || u.email}</span>
                            </span>
                            <span className="num" style={{ fontSize: 14, fontWeight: 600, color: bal < 0 ? 'var(--status-danger-fg)' : 'var(--color-ink)' }}>
                                {formatGel(bal)}
                            </span>
                        </button>
                    );
                })}
            </div>
        </Sheet>
    );
}
