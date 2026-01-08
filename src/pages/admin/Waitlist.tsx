import { useUserStore } from '../../store/userStore';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Clock, Trash2, Bell } from 'lucide-react';
import clsx from 'clsx';
import { RESOURCES } from '../../utils/data';

export function AdminWaitlist() {
    const { waitlist, removeFromWaitlist, users } = useUserStore();

    // Helper to get user name
    const getUserName = (userId: string) => {
        const u = users.find(u => u.email === userId);
        return u ? u.name : userId;
    };

    const handleNotify = (entryId: string) => {
        // Mock notification
        alert(`Уведомление отправлено пользователю! (ID запроса: ${entryId})`);
        // In real app, we might update status to 'fulfilled' or similar
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Лист ожидания</h1>
                <p className="text-gray-500">Пользователи, ожидающие освобождения слотов</p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 font-medium text-sm">
                        <tr>
                            <th className="p-4 pl-6">Дата запроса</th>
                            <th className="p-4">Клиент</th>
                            <th className="p-4">Интересующий слот</th>
                            <th className="p-4">Ресурс</th>
                            <th className="p-4 text-center">Статус</th>
                            <th className="p-4 text-right">Действия</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {waitlist.map(entry => {
                            const resourceName = RESOURCES.find(r => r.id === entry.resourceId)?.name || entry.resourceId;

                            return (
                                <tr key={entry.id} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="p-4 pl-6 text-gray-500 text-sm">
                                        {format(new Date(entry.dateCreated), 'dd.MM HH:mm')}
                                    </td>
                                    <td className="p-4 font-medium text-gray-900">
                                        {getUserName(entry.userId)}
                                        <div className="text-xs text-gray-400 font-normal">{entry.userId}</div>
                                    </td>
                                    <td className="p-4">
                                        <div className="font-bold flex items-center gap-2">
                                            {format(new Date(entry.date), 'dd MMMM', { locale: ru })}
                                        </div>
                                        <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                                            <Clock size={14} />
                                            {entry.startTime} - {entry.endTime}
                                        </div>
                                    </td>
                                    <td className="p-4 text-sm text-gray-600">
                                        {resourceName}
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className={clsx(
                                            "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                                            entry.status === 'active' ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-800"
                                        )}>
                                            {entry.status === 'active' ? 'Ожидает' : entry.status}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button
                                                onClick={() => handleNotify(entry.id)}
                                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
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
                    <div className="p-12 text-center text-gray-500">
                        Лист ожидания пуст
                    </div>
                )}
            </div>
        </div>
    );
}
