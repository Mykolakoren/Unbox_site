import { useNavigate } from 'react-router-dom';
import { ArrowRight, ClipboardCheck, Clock } from 'lucide-react';
import { GH, GH_MONO, GH_SANS } from '../hooks/useDesignFlag';
import { COLOR, STATUS } from '../design/tokens';
import type { SpecialistApplicationStatus } from '../hooks/useSpecialistApplication';
import { catalogPath, useInMobileShell } from '../utils/catalogPath';

/**
 * Карточка «сначала анкета специалиста» для тех, кому сервер не даёт
 * бронировать (require_can_book). Показываем её ДО выбора времени и оплаты,
 * а не отказом на последней кнопке.
 *
 * Два варианта текста (в /m — «здесь откроется»), оба на «вы» — решение
 * владельца 30.09: обращение на «вы» везде, включая /m.
 *
 * Волна 2 (E): внутри /m карточка ведёт на /m/become-specialist — анкета
 * открывается в мобильной оболочке с нижним меню, а не компьютерной
 * страницей. Срок проверки — решение владельца: «1 рабочий день».
 */

export const SPECIALIST_APPLICATION_PATH = '/become-specialist';
const ADMIN_TG_URL = 'https://t.me/UnboxCenter';

type Copy = { title: string; text: string; cta: string };

const MOBILE_COPY: Record<SpecialistApplicationStatus, Copy> = {
    none: {
        title: 'Чтобы бронировать кабинеты, заполните анкету специалиста',
        text: 'Администратор проверит анкету за 1 рабочий день — после этого здесь откроется бронирование.',
        cta: 'Заполнить анкету',
    },
    pending: {
        title: 'Анкета на проверке',
        text: 'Проверим её за 1 рабочий день. Как только одобрим, здесь откроется бронирование.',
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
        text: 'Администратор проверит анкету за 1 рабочий день — после этого откроется бронирование.',
        cta: 'Заполнить анкету',
    },
    pending: {
        title: 'Анкета на проверке',
        text: 'Проверим её за 1 рабочий день. Как только одобрим, откроется бронирование.',
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
    const inShell = useInMobileShell();
    const copy = (variant === 'mobile' ? MOBILE_COPY : DESKTOP_COPY)[status];
    const waiting = status === 'pending' || status === 'approved';
    const onCta = () => {
        if (status === 'approved') {
            window.open(ADMIN_TG_URL, '_blank', 'noopener,noreferrer');
            return;
        }
        // В /m — мобильный двойник анкеты, на компьютере — /become-specialist.
        navigate(catalogPath(SPECIALIST_APPLICATION_PATH, inShell));
    };
    const Icon = waiting ? Clock : ClipboardCheck;

    if (variant === 'mobile') {
        return (
            <div
                data-testid="specialist-gate"
                style={{
                    background: waiting ? STATUS.pending.bg : COLOR.sunken,
                    // Рамка «ждём» — янтарём на 35 % (0x59): цветом фона её не было видно.
                    // Серая — ink-20: ink-08 на сером фоне карточки сливалась с экраном.
                    border: `1px solid ${waiting ? `${STATUS.pending.fg}59` : COLOR.ink20}`,
                    borderRadius: 16,
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
                    type="button"
                    onClick={onCta}
                    className="press"
                    style={{
                        width: '100%',
                        minHeight: 44,
                        background: waiting ? COLOR.card : COLOR.ink,
                        color: waiting ? COLOR.ink : COLOR.onInk,
                        border: waiting ? `1px solid ${COLOR.ink}` : 'none',
                        borderRadius: 8,
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
                // Янтарная карточка без рамки сливалась с бумагой страницы.
                border: `1px solid ${waiting ? `${STATUS.pending.fg}59` : GH.ink}`,
                fontFamily: GH_SANS,
            }}
        >
            <div style={{ maxWidth: 560 }}>
                <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}>{copy.title}</div>
                <div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 4 }}>{copy.text}</div>
            </div>
            <button
                type="button"
                onClick={onCta}
                style={{
                    minHeight: 44,
                    padding: '0 16px',
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
