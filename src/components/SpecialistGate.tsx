import { useNavigate } from 'react-router-dom';
import { ArrowRight, ClipboardCheck, Clock } from 'lucide-react';
import { GH, GH_MONO, GH_SANS } from '../hooks/useDesignFlag';
import type { SpecialistApplicationStatus } from '../hooks/useSpecialistApplication';

/**
 * Карточка «сначала анкета специалиста» для тех, кому сервер не даёт
 * бронировать (require_can_book). Показываем её ДО выбора времени и оплаты,
 * а не отказом на последней кнопке.
 *
 * Два варианта текста: в мобильном /m на «ты», на компьютере — на «вы».
 */

export const SPECIALIST_APPLICATION_PATH = '/become-specialist';
const ADMIN_TG_URL = 'https://t.me/UnboxCenter';

type Copy = { title: string; text: string; cta: string };

const MOBILE_COPY: Record<SpecialistApplicationStatus, Copy> = {
    none: {
        title: 'Чтобы бронировать кабинеты, заполни анкету специалиста',
        text: 'Админ проверит анкету — после этого здесь откроется бронирование.',
        cta: 'Заполнить анкету',
    },
    pending: {
        title: 'Анкета на проверке',
        text: 'Как только админ её одобрит, здесь откроется бронирование.',
        cta: 'Посмотреть анкету',
    },
    rejected: {
        title: 'Анкета не прошла проверку',
        text: 'Поправь её и отправь ещё раз — после одобрения откроется бронирование.',
        cta: 'Открыть анкету',
    },
    approved: {
        title: 'Анкета одобрена',
        text: 'Доступ к бронированию откроет администратор. Если долго — напиши ему.',
        cta: 'Написать администратору',
    },
};

const DESKTOP_COPY: Record<SpecialistApplicationStatus, Copy> = {
    none: {
        title: 'Чтобы бронировать кабинеты, заполните анкету специалиста',
        text: 'Админ проверит анкету — после этого откроется бронирование.',
        cta: 'Заполнить анкету',
    },
    pending: {
        title: 'Анкета на проверке',
        text: 'Как только админ её одобрит, откроется бронирование.',
        cta: 'Посмотреть анкету',
    },
    rejected: {
        title: 'Анкета не прошла проверку',
        text: 'Поправьте её и отправьте ещё раз — после одобрения откроется бронирование.',
        cta: 'Открыть анкету',
    },
    approved: {
        title: 'Анкета одобрена',
        text: 'Доступ к бронированию откроет администратор. Если долго — напишите ему.',
        cta: 'Написать администратору',
    },
};

export function SpecialistGateCard({ variant, status }: {
    variant: 'mobile' | 'desktop';
    status: SpecialistApplicationStatus;
}) {
    const navigate = useNavigate();
    const copy = (variant === 'mobile' ? MOBILE_COPY : DESKTOP_COPY)[status];
    const waiting = status === 'pending' || status === 'approved';
    const onCta = () => {
        if (status === 'approved') {
            window.open(ADMIN_TG_URL, '_blank', 'noopener,noreferrer');
            return;
        }
        navigate(SPECIALIST_APPLICATION_PATH);
    };
    const Icon = waiting ? Clock : ClipboardCheck;

    if (variant === 'mobile') {
        return (
            <div
                data-testid="specialist-gate"
                style={{
                    background: waiting ? '#FFFBEB' : '#F4F4F2',
                    border: `1px solid ${waiting ? '#FCD34D' : 'rgba(0,0,0,0.06)'}`,
                    borderRadius: 14,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                }}
            >
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <Icon size={18} style={{ flexShrink: 0, marginTop: 2, color: waiting ? '#8A5A00' : '#0E0E0E' }} />
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, color: '#0E0E0E' }}>
                            {copy.title}
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.45, color: '#555', marginTop: 4 }}>
                            {copy.text}
                        </div>
                    </div>
                </div>
                <button
                    onClick={onCta}
                    className="press"
                    style={{
                        width: '100%',
                        background: waiting ? '#fff' : '#0E0E0E',
                        color: waiting ? '#0E0E0E' : '#fff',
                        border: waiting ? '1px solid #0E0E0E' : 'none',
                        borderRadius: 12,
                        padding: '13px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 15,
                        fontWeight: 700,
                    }}
                >
                    {copy.cta}
                    <ArrowRight size={17} />
                </button>
            </div>
        );
    }

    return (
        <div
            data-testid="specialist-gate"
            style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 16, padding: '16px 20px', flexWrap: 'wrap',
                background: waiting ? '#FEF3C7' : GH.ink,
                color: waiting ? '#92400E' : GH.paper,
                fontFamily: GH_SANS,
            }}
        >
            <div style={{ maxWidth: 560 }}>
                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35 }}>{copy.title}</div>
                <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 4, opacity: 0.85 }}>{copy.text}</div>
            </div>
            <button
                onClick={onCta}
                style={{
                    padding: '9px 16px',
                    background: waiting ? 'transparent' : GH.paper,
                    color: waiting ? '#92400E' : GH.ink,
                    border: waiting ? '1px solid #92400E' : 'none',
                    cursor: 'pointer',
                    fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
                    fontWeight: 700,
                }}
            >
                {copy.cta}
            </button>
        </div>
    );
}
