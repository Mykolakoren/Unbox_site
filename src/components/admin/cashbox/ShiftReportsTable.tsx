import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCashboxStore } from '../../../store/cashboxStore';

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
                        <th className="font-medium py-3">Админ</th>
                        <th className="font-medium py-3 text-right">Ожидаемо</th>
                        <th className="font-medium py-3 text-right">Факт</th>
                        <th className="font-medium py-3 text-right">Расхождение</th>
                        <th className="font-medium py-3 pr-2">Комментарий</th>
                    </tr>
                </thead>
                <tbody className="text-sm">
                    {shiftReports.map(r => {
                        const end = new Date(r.shiftEnd);
                        const discColor =
                            Math.abs(r.discrepancy) < 0.01
                                ? 'text-green-600'
                                : r.discrepancy > 0
                                    ? 'text-amber-600'
                                    : 'text-red-600';

                        return (
                            <tr key={r.id} className="hover:bg-gray-50/50 border-b border-gray-50 last:border-0 transition-colors">
                                <td className="py-3 pl-2 align-top">
                                    <div className="font-medium text-gray-900">
                                        {format(end, 'd MMM yyyy', { locale: ru })}
                                    </div>
                                    <div className="text-xs text-gray-400">
                                        {format(end, 'HH:mm')}
                                    </div>
                                </td>
                                <td className="py-3 align-top">
                                    <span className="text-gray-700">{r.adminName}</span>
                                </td>
                                <td className="py-3 align-top text-right font-medium text-gray-700">
                                    {r.expectedBalance.toFixed(2)} ₾
                                </td>
                                <td className="py-3 align-top text-right font-medium text-gray-900">
                                    {r.actualBalance.toFixed(2)} ₾
                                </td>
                                <td className={`py-3 align-top text-right font-bold ${discColor}`}>
                                    {Math.abs(r.discrepancy) < 0.01
                                        ? '0.00'
                                        : `${r.discrepancy > 0 ? '+' : ''}${r.discrepancy.toFixed(2)}`} ₾
                                </td>
                                <td className="py-3 pr-2 align-top">
                                    <span className="text-gray-500 text-xs truncate max-w-[150px] block">
                                        {r.notes || '—'}
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
