import { useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { User } from '../../store/types';
import { COLOR, RADIUS, STATUS, TEXT } from '../../design/tokens';
import { formatGel } from '../../utils/format';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';

/**
 * «Для кого бронь» — поиск человека по имени, телефону или почте с балансом
 * (ревью админки 09.11, №2а и №20). Раньше — выпадающий список без поиска и
 * по умолчанию «За себя»: легко было забронировать на себя или на соседнее имя.
 *
 * value: email выбранного человека, '' — «для себя», null — ещё не выбрано.
 */
export function ClientPickerSheet({ open, onClose, people, self, value, onPick }: {
    open: boolean;
    onClose: () => void;
    people: User[];
    self: User | null;
    value: string | null;
    onPick: (email: string | '') => void;
}) {
    const [q, setQ] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const found = useMemo(() => {
        const text = q.trim().toLowerCase();
        const digits = text.replace(/\D/g, '');
        const list = people.filter(u => u.email !== self?.email);
        if (!text) return list.slice(0, 30);
        return list.filter(u => {
            if ((u.name || '').toLowerCase().includes(text)) return true;
            if ((u.email || '').toLowerCase().includes(text)) return true;
            // Телефон — по цифрам: «599 32-46», «+995599324668» и «599324668» находят одно.
            const ph = (u.phone || '').replace(/\D/g, '');
            return digits.length >= 3 && ph.includes(digits);
        }).slice(0, 50);
    }, [q, people, self?.email]);

    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Для кого бронь?"
            description="Найдите человека — спишем с его баланса или абонемента."
            initialFocus={inputRef}
            footer={<Button variant="secondary" block onClick={onClose}>Закрыть</Button>}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="Имя, телефон или почта">
                    <Input ref={inputRef} kind="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Например, Елена или 599…" />
                </Field>
                <div role="listbox" aria-label="Люди" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {self && (
                        <PersonRow
                            title={`Для себя — ${self.name || self.email}`}
                            sub="Спишем с вашего баланса"
                            active={value === ''}
                            onClick={() => onPick('')}
                        />
                    )}
                    {found.map(u => (
                        <PersonRow
                            key={u.id}
                            title={u.name || u.email}
                            sub={[u.phone, u.email].filter(Boolean).join(' · ')}
                            balance={u.balance ?? 0}
                            active={value === u.email}
                            onClick={() => onPick(u.email)}
                        />
                    ))}
                    {found.length === 0 && (
                        <div style={{ background: COLOR.sunken, borderRadius: 12, padding: 16, textAlign: 'center', color: COLOR.ink60, fontSize: TEXT.small }}>
                            {people.length === 0 ? 'Загружаем список…' : 'Никого не нашли — проверьте имя или номер.'}
                        </div>
                    )}
                </div>
            </div>
        </Sheet>
    );
}

function PersonRow({ title, sub, balance, active, onClick }: {
    title: string; sub?: string; balance?: number; active: boolean; onClick: () => void;
}) {
    return (
        <button
            type="button"
            role="option"
            aria-selected={active}
            onClick={onClick}
            style={{
                width: '100%', minHeight: 52,
                background: active ? COLOR.accentSoft : COLOR.card,
                border: `1px solid ${active ? COLOR.accent : COLOR.ink10}`,
                borderRadius: RADIUS.control, padding: '8px 12px',
                display: 'flex', alignItems: 'center', gap: 10,
                fontFamily: 'inherit', textAlign: 'left', color: COLOR.ink, cursor: 'pointer',
            }}
        >
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: TEXT.small, fontWeight: 600 }}>{title}</span>
                {sub && <span style={{ display: 'block', fontSize: TEXT.caption, color: COLOR.ink60, marginTop: 1, overflowWrap: 'anywhere' }}>{sub}</span>}
            </span>
            {balance !== undefined && (
                <span className="num" style={{ fontSize: TEXT.small, fontWeight: 600, color: balance < 0 ? STATUS.danger.fg : COLOR.ink80, flexShrink: 0 }}>
                    {formatGel(balance, { fraction: 0 })}
                </span>
            )}
            {active && <Check size={16} aria-hidden="true" style={{ color: COLOR.accentInk, flexShrink: 0 }} />}
        </button>
    );
}
