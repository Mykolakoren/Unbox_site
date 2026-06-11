import { Compass, BarChart3, CheckSquare, Wallet, DoorOpen, Users, Inbox } from 'lucide-react';
import { OnboardingTour, type Step } from '../OnboardingTour';

export const ADMIN_TOUR_PREFIX = 'unbox.mobile.admin.tour.v1.';

/**
 * /m/admin onboarding tour — 6 steps walking new admins through the
 * mobile-admin workspace. Same runner as the cabinet tour, separate
 * storage key so the admin and cabinet "seen" flags are independent.
 */
const ADMIN_STEPS: Step[] = [
    {
        icon: Compass,
        title: 'Мобильная админ-панель',
        pill: 'Знакомство',
        body: (
            <>
                Здесь — <b>оперативное управление</b> Unbox с телефона: дашборд
                сегодняшних чисел, задачи, касса, кабинеты, юзеры, заявки. За
                30 секунд расскажем, что где.
            </>
        ),
    },
    {
        icon: BarChart3,
        title: 'Дашборд',
        pill: '1 из 6 · Главная',
        targetSelector: 'a[href="/m/admin/dashboard"]',
        body: (
            <>
                <b>Сегодняшние числа</b>: брони, выручка, новые юзеры, hot-броней
                в очереди. Тут же быстрый доступ к горячим заявкам и аномалиям —
                если что-то требует внимания, заметите сразу.
            </>
        ),
    },
    {
        icon: CheckSquare,
        title: 'Задачи',
        pill: '2 из 6 · Команда',
        targetSelector: 'a[href="/m/admin/tasks"]',
        body: (
            <>
                <b>Доска задач</b> с фильтрами по исполнителю и статусу. Создание
                новых, изменение статуса, прикреп к ответственному. Повторяющиеся
                задачи (уборка, проверки) — здесь же.
            </>
        ),
    },
    {
        icon: Wallet,
        title: 'Финансы',
        pill: '3 из 6 · Касса',
        targetSelector: 'a[href="/m/admin/finance"]',
        body: (
            <>
                Балансы по точкам и способам оплаты, добавление транзакций (FAB
                «+» в правом-нижнем), фильтр по периоду. Подходит для быстрых
                операций — глубокая аналитика на десктопе.
            </>
        ),
    },
    {
        icon: DoorOpen,
        title: 'Кабинеты',
        pill: '4 из 6 · Помещения',
        targetSelector: 'a[href="/m/admin/cabinets"]',
        body: (
            <>
                Три экрана в одном: <b>включение/выключение</b> кабинетов,
                <b>обслуживание</b> (закрыть на уборку/ремонт),
                <b>лист ожидания</b> по всем юзерам. Переключение под-вкладок
                сверху.
            </>
        ),
    },
    {
        icon: Users,
        title: 'Юзеры + Заявки',
        pill: '5 из 6 · Люди',
        targetSelector: 'a[href="/m/admin/users"]',
        body: (
            <>
                <b>Юзеры</b> — поиск, баланс, быстрые действия (пополнить,
                назначить специалистом, дать CRM-доступ). <b>Заявки</b>
                (последняя вкладка) — hot-брони и запросы на доступ; одобрение/
                отклонение в один тап.
            </>
        ),
    },
    {
        icon: Inbox,
        title: 'Готовы',
        pill: '6 из 6',
        body: (
            <>
                Стрелка ← сверху возвращает в обычный мобильный кабинет. Все
                критичные операции (отмена брони, перенос, изменение цены)
                по-прежнему предлагают подтверждение — лишних кликов не сделаете.
            </>
        ),
    },
];

export function MobileAdminTour({ onClose }: { onClose: () => void }) {
    return (
        <OnboardingTour
            onClose={onClose}
            steps={ADMIN_STEPS}
            storagePrefix={ADMIN_TOUR_PREFIX}
        />
    );
}
