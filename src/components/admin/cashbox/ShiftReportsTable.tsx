import { ru } from 'date-fns/locale';
import { useCashboxStore } from '../../../store/cashboxStore';
import { parseUTC, formatBatumi } from '../../../utils/dateUtils';

export function ShiftReportsTable() {
    const { shiftReports } = useCashboxStore();

    if (shiftReports.length === 0) {
        return (
            <div className="text-center py-12 bg-gray-50 rounded-xl text-gray-500 text-sm">
                Отчётов по сменам пока нет
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                        <th className="font-medium py-3 pl-2">Период</th>
                        <th className="font-medium py-3">Филиал</th>
                        <th className="font-medium py-3">Админ</th>
                        <th className="font-medium py-3 text-right">Ожидаемо</th>
                        <th className="font-medium py-3 text-right">Факт</th>
                        <th className="font-medium py-3 text-right">Расхождение</th>
                        <th className="font-medium py-3 pr-2">Комментарий</th>
                    </tr>
                </thead>
                <tbody className="text-sm">
                    {shiftReports.map(r => {
                        const end = parseUTC(r.shiftEnd);
                        // Every numeric field is defensively normalised to a
                        // number — old rows in the DB have nulls in columns
                        // that are `number` in the TS interface, and any
                        // single `.toFixed()` on undefined blows up the
                        // whole Admin-Panel boundary (reported by Иры).
                        const expected = Number(r.expectedBalance ?? 0);
                        const actual = Number(r.actualBalance ?? 0);
                        const disc = Number(r.discrepancy ?? 0);
                        const discColor =
                            Math.abs(disc) < 0.01
                                ? 'text-green-600'
                                : disc > 0
                                    ? 'text-amber-600'
                                    : 'text-red-600';

                        return (
                            <tr key={r.id} className="hover:bg-gray-50/50 border-b border-gray-50 last:border-0 transition-colors">
                                <td className="py-3 pl-2 align-top">
                                    <div className="font-medium text-gray-900">
                                        {formatBatumi(end, 'd MMM yyyy', ru)}
                                    </div>
                                    <div className="text-xs text-gray-400">
                                        {formatBatumi(end, 'HH:mm')}
                                    </div>
                                </td>
                                <td className="py-3 align-top">
                                    {r.branch ? (
                                        <span className="inline-block text-[10px] uppercase tracking-wider font-semibold text-unbox-green bg-unbox-green/10 rounded-md px-2 py-0.5">
                                            {r.branch}
                                        </span>
                                    ) : (
                                        <span className="inline-block text-[10px] uppercase tracking-wider font-semibold text-gray-500 bg-gray-100 rounded-md px-2 py-0.5">
                                            Все
                                        </span>
                                    )}
                                </td>
                                <td className="py-3 align-top">
                                    <span className="text-gray-700">{r.adminName}</span>
                                </td>
                                <td className="py-3 align-top text-right font-medium text-gray-700">
                                    {expected.toFixed(2)} ₾
                                </td>
                                <td className="py-3 align-top text-right font-medium text-gray-900">
                                    {actual.toFixed(2)} ₾
                                </td>
                                <td className={`py-3 align-top text-right font-bold ${discColor}`}>
                                    {Math.abs(disc) < 0.01
                                        ? '0.00'
                                        : `${disc > 0 ? '+' : ''}${disc.toFixed(2)}`} ₾
                                </td>
                                <td className="py-3 pr-2 align-top">
                                    <span className="text-gray-500 text-xs truncate max-w-[150px] block">
                                        {/* Legacy "[Branch] ..." prefix is stripped — branch now lives in its own column. */}
                                        {(r.notes || '').replace(/^\[[^\]]+\]\s*/, '') || '—'}
                                    </span>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
