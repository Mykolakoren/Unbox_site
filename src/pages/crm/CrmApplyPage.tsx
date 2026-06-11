import { useState, useEffect } from 'react';
import { BriefcaseMedical, CheckCircle2, ChevronRight, Clock, Loader2 } from 'lucide-react';
import { api } from '../../api/client';
import { crmApi } from '../../api/crm';
import { toast } from 'sonner';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

export function CrmApplyPage() {
        const [sent, setSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [checkingStatus, setCheckingStatus] = useState(true);
    const [alreadyPending, setAlreadyPending] = useState(false);
    const [form, setForm] = useState({ profession: '', message: '' });

    // Check if user already has a pending request
    useEffect(() => {
        crmApi.getMyAccess()
            .then(access => {
                if (access.accessStatus === 'pending') setAlreadyPending(true);
                if (access.accessStatus === 'active') setSent(true); // treat active as sent
            })
            .catch(() => {})
            .finally(() => setCheckingStatus(false));
    }, []);

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
        } catch (err: any) {
            const msg = err?.response?.data?.detail || 'Ошибка отправки заявки';
            toast.error(msg);
            // If already pending — show the pending state
            if (err?.response?.status === 400) {
                setAlreadyPending(true);
            }
        } finally {
            setLoading(false);
        }
    };

    // ─── Grid House variant (behind feature flag) ────────────────────────
    return (

        <GridHouseCrmApplyPage
            sent={sent}
            loading={loading}
            checkingStatus={checkingStatus}
            alreadyPending={alreadyPending}
            form={form}
            setForm={setForm}
            handleSubmit={handleSubmit}
        />
    );
}


// ─────────────────────────────────────────────────────────────────────────
// GRID HOUSE CRM APPLY — newspaper-front-desk variant
// Rollback: delete this component + its early-return above.
// ─────────────────────────────────────────────────────────────────────────

const GH_HAIRLINE = `1px solid ${GH.ink10}`;
const GH_MONO_LABEL: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
    color: GH.ink60,
};

interface GridHouseCrmApplyPageProps {
    sent: boolean;
    loading: boolean;
    checkingStatus: boolean;
    alreadyPending: boolean;
    form: { profession: string; message: string };
    setForm: React.Dispatch<React.SetStateAction<{ profession: string; message: string }>>;
    handleSubmit: (e: React.FormEvent) => void;
}

const FEATURES = [
    'База клиентов с историей и заметками',
    'Расписание сессий с бронированием кабинетов',
    'Финансовый учёт по периодам',
    'Интеграция с системой бронирования Unbox',
];

function GridHouseCrmApplyPage({
    sent,
    loading,
    checkingStatus,
    alreadyPending,
    form,
    setForm,
    handleSubmit,
}: GridHouseCrmApplyPageProps) {
    if (checkingStatus) {
        return (
            <div
                style={{
                    minHeight: '100vh',
                    background: GH.paper,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: GH_SANS,
                }}
            >
                <Loader2 size={24} style={{ color: GH.ink30, animation: 'spin 1s linear infinite' }} />
            </div>
        );
    }

    // Pending state
    if (alreadyPending) {
        return (
            <div
                style={{
                    minHeight: '100vh',
                    background: GH.paper,
                    color: GH.ink,
                    fontFamily: GH_SANS,
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
                    <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
                        <div style={{ ...GH_MONO_LABEL, marginBottom: 24 }}>Статус · На рассмотрении</div>
                        <Clock size={32} style={{ color: GH.ink30, margin: '0 auto 24px' }} />
                        <h2
                            style={{
                                fontSize: 'clamp(28px, 3.5vw, 42px)',
                                fontWeight: 800,
                                letterSpacing: '-0.02em',
                                marginBottom: 16,
                            }}
                        >
                            Заявка на рассмотрении
                        </h2>
                        <p style={{ fontSize: 16, lineHeight: 1.6, color: GH.ink60, maxWidth: 400, margin: '0 auto' }}>
                            Ваша заявка уже отправлена и ожидает рассмотрения администратором.
                            Вы получите уведомление, когда доступ будет предоставлен.
                        </p>
                    </div>
                </div>
                <GHFooter />
            </div>
        );
    }

    // Sent / success state
    if (sent) {
        return (
            <div
                style={{
                    minHeight: '100vh',
                    background: GH.paper,
                    color: GH.ink,
                    fontFamily: GH_SANS,
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
                    <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
                        <div style={{ ...GH_MONO_LABEL, marginBottom: 24 }}>Статус · Отправлено</div>
                        <CheckCircle2 size={32} style={{ color: GH.accent, margin: '0 auto 24px' }} />
                        <h2
                            style={{
                                fontSize: 'clamp(28px, 3.5vw, 42px)',
                                fontWeight: 800,
                                letterSpacing: '-0.02em',
                                marginBottom: 16,
                            }}
                        >
                            Заявка отправлена
                        </h2>
                        <p style={{ fontSize: 16, lineHeight: 1.6, color: GH.ink60, maxWidth: 400, margin: '0 auto' }}>
                            Администратор рассмотрит вашу заявку и откроет доступ к CRM-кабинету специалиста.
                            Вы получите уведомление, когда доступ будет предоставлен.
                        </p>
                    </div>
                </div>
                <GHFooter />
            </div>
        );
    }

    // Main form state
    return (
        <div
            style={{
                minHeight: '100vh',
                background: GH.paper,
                color: GH.ink,
                fontFamily: GH_SANS,
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            {/* Content */}
            <div
                style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '64px 24px',
                }}
            >
                <div style={{ maxWidth: 520, width: '100%' }}>
                    {/* Eyebrow */}
                    <div style={{ ...GH_MONO_LABEL, marginBottom: 24 }}>
                        CRM · Заявка на доступ
                    </div>

                    {/* Title */}
                    <h1
                        style={{
                            fontSize: 'clamp(28px, 3.5vw, 42px)',
                            fontWeight: 800,
                            letterSpacing: '-0.02em',
                            lineHeight: 1.05,
                            marginBottom: 16,
                        }}
                    >
                        CRM для специалистов.
                    </h1>

                    {/* Subtitle */}
                    <p
                        style={{
                            fontSize: 16,
                            lineHeight: 1.6,
                            color: GH.ink60,
                            marginBottom: 40,
                            maxWidth: 440,
                        }}
                    >
                        Кабинет терапевта и психолога. Ведите учёт клиентов, сессий и финансов,
                        бронируйте кабинеты прямо из расписания.
                    </p>

                    {/* Features */}
                    <div style={{ marginBottom: 40 }}>
                        <div style={{ ...GH_MONO_LABEL, marginBottom: 16 }}>Что входит</div>
                        {FEATURES.map((feature) => (
                            <div
                                key={feature}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    padding: '10px 0',
                                    borderBottom: GH_HAIRLINE,
                                    fontSize: 15,
                                    color: GH.ink,
                                    fontFamily: GH_SANS,
                                }}
                            >
                                <ChevronRight size={14} style={{ color: GH.accent, flexShrink: 0 }} />
                                {feature}
                            </div>
                        ))}
                    </div>

                    {/* Divider */}
                    <div style={{ borderTop: `2px solid ${GH.ink}`, marginBottom: 32 }} />

                    {/* Form section */}
                    <div style={{ ...GH_MONO_LABEL, marginBottom: 20 }}>
                        Подать заявку
                    </div>

                    <form onSubmit={handleSubmit}>
                        {/* Profession field */}
                        <div style={{ marginBottom: 24 }}>
                            <div style={{ ...GH_MONO_LABEL, marginBottom: 8 }}>
                                Специализация
                            </div>
                            <input
                                type="text"
                                required
                                placeholder="Например: психотерапевт, гипнолог..."
                                value={form.profession}
                                onChange={e => setForm(f => ({ ...f, profession: e.target.value }))}
                                style={{
                                    width: '100%',
                                    border: 'none',
                                    borderBottom: `1px solid ${GH.ink10}`,
                                    background: 'transparent',
                                    fontFamily: GH_SANS,
                                    fontSize: 16,
                                    color: GH.ink,
                                    padding: '8px 0',
                                    outline: 'none',
                                    borderRadius: 0,
                                }}
                            />
                        </div>

                        {/* Message field */}
                        <div style={{ marginBottom: 24 }}>
                            <div style={{ ...GH_MONO_LABEL, marginBottom: 8 }}>
                                Сообщение — необязательно
                            </div>
                            <textarea
                                rows={3}
                                placeholder="Расскажите немного о себе и своей практике..."
                                value={form.message}
                                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                                style={{
                                    width: '100%',
                                    border: 'none',
                                    borderBottom: `1px solid ${GH.ink10}`,
                                    background: 'transparent',
                                    fontFamily: GH_SANS,
                                    fontSize: 16,
                                    color: GH.ink,
                                    padding: '8px 0',
                                    outline: 'none',
                                    borderRadius: 0,
                                    resize: 'none',
                                }}
                            />
                        </div>

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                width: '100%',
                                padding: '16px 24px',
                                background: GH.ink,
                                color: GH.paper,
                                border: 'none',
                                fontFamily: GH_MONO,
                                fontSize: 11,
                                textTransform: 'uppercase',
                                letterSpacing: '0.18em',
                                fontWeight: 600,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                opacity: loading ? 0.6 : 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 10,
                                transition: 'opacity 0.15s ease',
                                borderRadius: 0,
                            }}
                        >
                            {loading && (
                                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                            )}
                            <span>Отправить заявку</span>
                        </button>

                        {/* Footnote */}
                        <p
                            style={{
                                ...GH_MONO_LABEL,
                                fontSize: 10,
                                textAlign: 'center',
                                marginTop: 16,
                                color: GH.ink30,
                            }}
                        >
                            Заявка поступит администратору. Доступ открывается вручную.
                        </p>
                    </form>
                </div>
            </div>

            {/* Footer */}
            <GHFooter />
        </div>
    );
}

function GHFooter() {
    return (
        <footer
            style={{
                borderTop: `2px solid ${GH.ink}`,
                padding: '16px 32px',
                ...GH_MONO_LABEL,
            }}
        >
            <span>UNBOX · 2026</span>
        </footer>
    );
}
