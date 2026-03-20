/**
 * Dynamic payment account selector for Psy CRM.
 * Uses specialist's custom accounts from crmStore instead of hardcoded options.
 */
import { useCrmStore } from '../../store/crmStore';

interface AccountSelectProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export function AccountSelect({ value, onChange, className }: AccountSelectProps) {
    const { paymentAccounts } = useCrmStore();

    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={className || "w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"}
        >
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
    return (accountId: string) => {
        const acc = paymentAccounts.find((a) => a.id === accountId);
        return acc?.label || accountId;
    };
}
