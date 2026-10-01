/**
 * Dynamic payment account selector for Psy CRM.
 * Uses specialist's custom accounts from crmStore instead of hardcoded options.
 */
import { useCrmStore } from '../../store/crmStore';
import { accountLabel, accountSelectValue } from '../../utils/paymentAccounts';

interface AccountSelectProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export function AccountSelect({ value, onChange, className }: AccountSelectProps) {
    const { paymentAccounts } = useCrmStore();
    // В базе счёт мог быть записан как «Cash» или «TBC» — показываем соответствующий
    // пункт списка («cash», «tbc»), а не первый попавшийся. Счёта нет в списке вовсе —
    // оставляем его выбираемым, чтобы выбор не подменился молча.
    const current = accountSelectValue(value, paymentAccounts);
    const missing = current && !paymentAccounts.some(a => a.id === current);

    return (
        <select
            value={current}
            onChange={(e) => onChange(e.target.value)}
            className={className || "w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"}
        >
            {missing && <option value={current}>{current}</option>}
            {paymentAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                    {acc.label}
                </option>
            ))}
        </select>
    );
}

/** Helper: get label for an account id */
export function useAccountLabel() {
    const { paymentAccounts } = useCrmStore();
    return (accountId: string) => accountLabel(accountId, paymentAccounts);
}
