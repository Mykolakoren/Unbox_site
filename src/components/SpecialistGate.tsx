import { useNavigate } from 'react-router-dom';
import { ArrowRight, ClipboardCheck, Clock } from 'lucide-react';
import { GH, GH_MONO, GH_SANS } from '../hooks/useDesignFlag';
import { COLOR, STATUS } from '../design/tokens';
import type { SpecialistApplicationStatus } from '../hooks/useSpecialistApplication';

/**
 * Карточка «сначала анкета специалиста» для тех, кому сервер не даёт
 * бронировать (require_can_book). Показываем её ДО выбора времени и оплаты,
 * а не отказом на последней кнопке.
 *
 * Два варианта текста (в /m — «здесь откроется»), оба на «вы» — решение
 * владельца 30.09: обращение на «вы» везде, включая /m.
 */

export const SPECIALIST_APPLICATION_PATH = '/become-specialist';
const ADMIN_TG_URL = 'https://t.me/UnboxCenter';

type Copy = { title: string; text: string; cta: string };

const MOBILE_COPY: Record<SpecialistApplicationStatus, Copy> = {
    none: {
        title: 'Чтобы бронировать кабинеты, заполните анкету специалиста',
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
        text: 'Поправьте её и отправьте ещё раз — после одобрения здесь откроется бронирование.',
        cta: 'Открыть анкету',
    },
    approved: {
        title: 'Анкета одобрена',
        text: 'Доступ к бронированию откроет администратор. Если долго — напишите ему.',
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
                    background: waiting ? STATUS.pending.bg : COLOR.sunken,
                    border: `1px solid ${waiting ? STATUS.pending.bg : COLOR.ink08}`,
                    borderRadius: 14,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                }}
            >
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <Icon size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: waiting ? STATUS.pending.fg : COLOR.ink }} />
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3, color: COLOR.ink }}>
                            {copy.title}
                        </div>
                        <div style={{ fontSize: 14, lineHeight: 1.45, color: COLOR.ink80, marginTop: 4 }}>
                            {copy.text}
                        </div>
                    </div>
                </div>
                <button
                    onClick={onCta}
                    className="press"
                    style={{
                        width: '100%',
                        background: waiting ? COLOR.card : COLOR.ink,
                        color: waiting ? COLOR.ink : COLOR.onInk,
                        border: waiting ? `1px solid ${COLOR.ink}` : 'none',
                        borderRadius: 12,
                        padding: '13px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 16,
                        fontWeight: 600,
                    }}
                >
                    {copy.cta}
                    <ArrowRight size={18} aria-hidden="true" />
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
                background: waiting ? STATUS.pending.bg : GH.ink,
                color: waiting ? STATUS.pending.fg : GH.paper,
                fontFamily: GH_SANS,
            }}
        >
            <div style={{ maxWidth: 560 }}>
                <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}>{copy.title}</div>
                <div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 4 }}>{copy.text}</div>
            </div>
            <button
                onClick={onCta}
                style={{
                    padding: '9px 16px',
                    background: waiting ? 'transparent' : GH.paper,
                    color: waiting ? STATUS.pending.fg : GH.ink,
                    border: waiting ? `1px solid ${STATUS.pending.fg}` : 'none',
                    cursor: 'pointer',
                    fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                    fontWeight: 600,
                }}
            >
                {copy.cta}
            </button>
        </div>
    );
}
