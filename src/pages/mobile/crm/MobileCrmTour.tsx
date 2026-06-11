import { Compass, CalendarDays, Users, Wallet, FileText, UserCircle } from 'lucide-react';
import { OnboardingTour, type Step } from '../OnboardingTour';

/** Storage prefix used to track whether the CRM tour was seen. Versioned
 *  so we can re-fire after a meaningful UX change by bumping the suffix. */
export const CRM_TOUR_PREFIX = 'unbox.mobile.crm.tour.v1.';

/**
 * /m/crm onboarding tour — 5 steps that orient new specialists in their
 * mobile CRM workspace before they touch a client record. Uses the same
 * spotlight runner as the cabinet tour, just with CRM-specific steps and
 * a separate localStorage key so cabinet vs CRM tours track independently.
 */
const CRM_STEPS: Step[] = [
    {
        icon: Compass,
        title: 'Мобильная CRM специалиста',
        pill: 'Знакомство',
        body: (
            <>
                Это <b>отдельное пространство для работы с клиентами</b>: сессии,
                заметки, оплаты, ваша анкета и финансы. Кабинеты-брони — это другая
                вкладка («Кабинет» в верхнем углу). Покажем за полминуты, как
                ориентироваться.
            </>
        ),
    },
    {
        icon: CalendarDays,
        title: 'Сегодня',
        pill: '1 из 5 · Главная',
        targetSelector: 'a[href="/m/crm/today"]',
        body: (
            <>
                <b>Сессии на сегодня</b> с быстрыми действиями: открыть карточку
                клиента, отметить оплату, перенести/отменить, добавить заметку.
                Стрелки вверху — пройтись по другим датам.
            </>
        ),
    },
    {
        icon: Users,
        title: 'Клиенты',
        pill: '2 из 5 · Карточки',
        targetSelector: 'a[href="/m/crm/clients"]',
        body: (
            <>
                Все ваши клиенты с поиском, тегами и сортировкой. Тап по карточке —
                история сессий, платежи, заметки, цена, частота, контакты. Свайп
                влево — быстрые действия.
            </>
        ),
    },
    {
        icon: Wallet,
        title: 'Финансы',
        pill: '3 из 5 · Деньги',
        targetSelector: 'a[href="/m/crm/finance"]',
        body: (
            <>
                <b>Доход за месяц</b>, общая <b>задолженность</b> и список
                должников. Тап по строке — переход в карточку клиента, где можно
                провести платёж или отметить сессию оплаченной.
            </>
        ),
    },
    {
        icon: FileText,
        title: 'Заметки + Анкета',
        pill: '4 из 5 · Остальное',
        targetSelector: 'a[href="/m/crm/notes"]',
        body: (
            <>
                <b>Заметки</b> — все ваши клиентские записи в одной ленте, поиск
                по клиенту и тегу. <b>Анкета</b> (последняя вкладка) — публичный
                профиль для каталога: фото, био, цены, форматы, специализации.
            </>
        ),
    },
    {
        icon: UserCircle,
        title: 'Готовы работать',
        pill: '5 из 5',
        body: (
            <>
                Если у вас несколько ролей (специалист + админ) — кнопка ←
                наверху возвращает в <b>«Кабинет»</b>, оттуда в админ-панель.
                Эту экскурсию можно запустить снова на «Анкете» внизу.
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
