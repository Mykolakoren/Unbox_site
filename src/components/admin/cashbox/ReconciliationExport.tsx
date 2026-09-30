import { useState } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cashboxApi } from '../../../api/cashbox';
import { GH, GH_MONO } from '../../../hooks/useDesignFlag';

/**
 * «Выгрузка для сверки» — Excel за месяц в разрезах таблицы админов
 * «Аренда 2026 Unbox»: сводка по клиентам (нал/TBC/BOG, списано, возвраты,
 * скидки, остатки), брони месяца, все операции по балансу, инструкция.
 */
export function ReconciliationExport() {
    const [month, setMonth] = useState(() => format(new Date(), 'yyyy-MM'));
    const [busy, setBusy] = useState(false);

    const download = async () => {
        if (!/^\d{4}-\d{2}$/.test(month)) { toast.error('Выберите месяц'); return; }
        setBusy(true);
        try {
            const blob = await cashboxApi.downloadReconciliation(month);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `unbox-sverka-${month}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            toast.success('Файл для сверки скачан');
        } catch (e: any) {
            let detail = 'Не удалось сформировать выгрузку';
            const data = e?.response?.data;
            if (data instanceof Blob) {
                try { detail = JSON.parse(await data.text())?.detail || detail; } catch { /* оставляем общее */ }
            }
            toast.error(detail);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${GH.ink}` }}
             title="Excel за месяц для сверки с таблицей «Аренда 2026 Unbox»: по клиентам, броням и всем операциям">
            <input
                type="month"
                value={month}
                onChange={e => setMonth(e.target.value)}
                aria-label="Месяц выгрузки"
                style={{ border: 'none', padding: '8px 10px', fontFamily: GH_MONO, fontSize: 12, background: GH.paper, color: GH.ink }}
            />
            <button
                onClick={download}
                disabled={busy}
                style={{
                    fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                    padding: '10px 14px', border: 'none', borderLeft: `1px solid ${GH.ink}`,
                    background: 'transparent', color: GH.ink, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.5 : 1,
                }}
            >
                {busy ? 'Готовим…' : 'Выгрузка для сверки'}
            </button>
        </div>
    );
}
