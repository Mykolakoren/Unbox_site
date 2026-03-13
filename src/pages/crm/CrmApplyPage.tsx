import { useState } from 'react';
import { BriefcaseMedical, CheckCircle2, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../../api/client';
import { toast } from 'sonner';

export function CrmApplyPage() {
    const [sent, setSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({ profession: '', message: '' });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await api.post('/crm/apply', {
                profession: form.profession,
                message: form.message,
            });
            setSent(true);
            toast.success('Заявка отправлена');
        } catch {
            toast.error('Ошибка отправки заявки');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full">
                {sent ? (
                    <div className="bg-white rounded-2xl p-8 text-center shadow-sm border border-gray-100">
                        <CheckCircle2 size={48} className="text-unbox-green mx-auto mb-4" />
                        <h2 className="text-xl font-semibold text-unbox-dark mb-2">Заявка отправлена</h2>
                        <p className="text-unbox-grey text-sm">
                            Администратор рассмотрит вашу заявку и откроет доступ к CRM-кабинету специалиста.
                            Вы получите уведомление, когда доступ будет предоставлен.
                        </p>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        {/* Header */}
                        <div className="bg-unbox-green/5 border-b border-unbox-light p-6">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-xl bg-unbox-green/10 flex items-center justify-center">
                                    <BriefcaseMedical size={20} className="text-unbox-green" />
                                </div>
                                <div>
                                    <h1 className="text-lg font-semibold text-unbox-dark">CRM для специалистов</h1>
                                    <p className="text-xs text-unbox-grey">Кабинет терапевта и психолога</p>
                                </div>
                            </div>
                            <p className="text-sm text-unbox-grey">
                                CRM-кабинет позволяет вести учёт клиентов, сессий и финансов,
                                а также бронировать кабинеты прямо из расписания.
                            </p>
                        </div>

                        {/* Features */}
                        <div className="p-6 border-b border-unbox-light">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-unbox-grey mb-3">Что входит</h3>
                            <ul className="space-y-2">
                                {[
                                    'База клиентов с историей и заметками',
                                    'Расписание сессий с бронированием кабинетов',
                                    'Финансовый учёт по периодам',
                                    'Интеграция с системой бронирования Unbox',
                                ].map(feature => (
                                    <li key={feature} className="flex items-center gap-2 text-sm text-unbox-dark">
                                        <ChevronRight size={14} className="text-unbox-green flex-shrink-0" />
                                        {feature}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <h3 className="text-sm font-semibold text-unbox-dark">Подать заявку на доступ</h3>

                            <div>
                                <label className="block text-xs font-medium text-unbox-grey mb-1">
                                    Специализация
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Например: психотерапевт, гипнолог..."
                                    value={form.profession}
                                    onChange={e => setForm(f => ({ ...f, profession: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green/30 focus:border-unbox-green"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-unbox-grey mb-1">
                                    Сообщение (необязательно)
                                </label>
                                <textarea
                                    rows={3}
                                    placeholder="Расскажите немного о себе и своей практике..."
                                    value={form.message}
                                    onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green/30 focus:border-unbox-green resize-none"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90 transition-colors disabled:opacity-60"
                            >
                                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                                Отправить заявку
                            </button>

                            <p className="text-[11px] text-unbox-grey text-center">
                                Заявка поступит администратору. Доступ открывается вручную.
                            </p>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}
