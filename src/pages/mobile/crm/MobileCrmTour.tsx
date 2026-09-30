import { Compass, CalendarDays, Users, Wallet, FileText, UserCircle } from 'lucide-react';
import { OnboardingTour, type Step } from '../OnboardingTour';

/** Storage prefix used to track whether the CRM tour was seen. Versioned
 *  so we can re-fire after a meaningful UX change by bumping the suffix. */
export const CRM_TOUR_PREFIX = 'unbox.mobile.crm.tour.v1.';

/**
 * /m/crm onboarding tour — steps that orient new specialists in their
 * mobile CRM workspace before they touch a client record. Uses the same
 * spotlight runner as the cabinet tour, just with CRM-specific steps and
 * a separate localStorage key so cabinet vs CRM tours track independently.
 *
 * Wave 1 (аудит G6-11): тексты переписаны под то, что реально есть на
 * телефоне. Раньше тур обещал теги, сортировку, свайп-действия в клиентах,
 * платёж из карточки клиента и кнопку повтора экскурсии — их нет.
 * Счётчик «1 из 5» убран — положение показывают полоски. Префикс не
 * меняли: тур не всплывёт заново у тех, кто его уже видел.
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
                кабинете, кнопка «Кабинет» слева вверху. Покажем за полминуты, что где.
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
                <b>Сессии на день.</b> Нажмите на сессию — можно отметить, что она
                прошла, отметить оплату, перенести, отменить или добавить заметку.
                Другие дни — стрелками сверху или свайпом.
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
                Все ваши клиенты с поиском по имени, телефону и коду. В карточке —
                контакты, баланс и история: сессии, оплаты и заметки в одной ленте.
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
                <b>Доход за месяц</b>, общая <b>задолженность</b> и список
                должников. Нажмите на должника — откроется его карточка с историей
                сессий. Оплату отмечайте в шторке сессии.
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
                по тексту и имени. <b>Анкета</b> (последняя вкладка) — профиль в
                каталоге: фото, описание, цена, форматы, часы приёма и отпуск.
            </>
        ),
    },
    {
        icon: UserCircle,
        title: 'Готово',
        pill: 'Всё',
        body: (
            <>
                Кнопка <b>«Кабинет»</b> вверху возвращает в личный кабинет — там
                брони кабинетов, а для администраторов вход в админку.
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
