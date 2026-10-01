import { Compass, CalendarDays, Users, Wallet, FileText, UserCircle } from 'lucide-react';
import { OnboardingTour, type Step } from '../OnboardingTour';

/** Storage prefix used to track whether the CRM tour was seen. Versioned
 *  so we can re-fire after a meaningful UX change by bumping the suffix. */
// v2 (волна 3): вкладки и шапка поменялись — тур покажется ещё раз.
export const CRM_TOUR_PREFIX = 'unbox.mobile.crm.tour.v2.';

/**
 * /m/crm onboarding tour — steps that orient new specialists in their
 * mobile CRM workspace before they touch a client record. Uses the same
 * spotlight runner as the cabinet tour, just with CRM-specific steps and
 * a separate localStorage key so cabinet vs CRM tours track independently.
 *
 * Wave 1 (аудит G6-11): тексты переписаны под то, что реально есть на
 * телефоне. Раньше тур обещал теги, сортировку, свайп-действия в клиентах,
 * платёж из карточки клиента и кнопку повтора экскурсии — их нет.
 * Счётчик «1 из 5» убран — положение показывают полоски.
 * Волна 3: «Сессии» стали вкладкой, «Анкета» ушла в меню «Psy-CRM ▾»,
 * появились «Записать следующую» и оплата в один тап — тексты и префикс v2.
 */
const CRM_STEPS: Step[] = [
    {
        icon: Compass,
        title: 'Мобильная CRM специалиста',
        pill: 'Знакомство',
        body: (
            <>
                Это <b>отдельное пространство для работы с клиентами</b>: сессии,
                заметки, оплаты, финансы и ваша анкета. Брони кабинетов — в личном
                кабинете: меню «Psy-CRM» слева вверху. Покажем за полминуты, что где.
            </>
        ),
    },
    {
        icon: CalendarDays,
        title: 'Сегодня',
        pill: 'Главная',
        targetSelector: 'a[href="/m/crm/today"]',
        body: (
            <>
                <b>Сессии на день.</b> Нажмите на сессию — можно записать следующую,
                отметить оплату, перенести, отменить или добавить заметку. Оплату
                прошедшей сессии — одной кнопкой «Оплата». Другие дни — в ленте
                недели или свайпом.
            </>
        ),
    },
    {
        icon: Users,
        title: 'Клиенты',
        pill: 'Карточки',
        targetSelector: 'a[href="/m/crm/clients"]',
        body: (
            <>
                Все ваши клиенты с поиском и кнопкой «+ Клиент». В карточке —
                следующая встреча, долг, история сессий, оплат и заметок.
            </>
        ),
    },
    {
        icon: Wallet,
        title: 'Финансы',
        pill: 'Деньги',
        targetSelector: 'a[href="/m/crm/finance"]',
        body: (
            <>
                <b>Касса · с долгами</b> — все оплаты за месяц, и отдельно <b>долги
                сейчас</b>. Нажмите на должника — в его карточке можно отметить
                оплату.
            </>
        ),
    },
    {
        icon: FileText,
        title: 'Заметки и анкета',
        pill: 'Остальное',
        targetSelector: 'a[href="/m/crm/notes"]',
        body: (
            <>
                <b>Заметки</b> — все ваши записи о клиентах в одной ленте, с поиском
                по тексту и имени. <b>Анкета</b> и <b>часы приёма</b> — в меню
                «Psy-CRM» слева вверху.
            </>
        ),
    },
    {
        icon: UserCircle,
        title: 'Готово',
        pill: 'Всё',
        body: (
            <>
                Меню <b>«Psy-CRM»</b> вверху ведёт в личный кабинет — там брони
                кабинетов, а администраторам — в админку.
            </>
        ),
    },
];

export function MobileCrmTour({ onClose }: { onClose: () => void }) {
    return (
        <OnboardingTour
            onClose={onClose}
            steps={CRM_STEPS}
            storagePrefix={CRM_TOUR_PREFIX}
        />
    );
}
