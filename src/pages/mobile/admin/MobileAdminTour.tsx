import { Compass, BarChart3, CalendarDays, CheckSquare, Wallet, Users, Inbox } from 'lucide-react';
import { OnboardingTour, type Step } from '../OnboardingTour';

export const ADMIN_TOUR_PREFIX = 'unbox.mobile.admin.tour.v1.';

/**
 * /m/admin onboarding tour — walks new admins through the mobile-admin
 * workspace, one step per bottom tab. Same runner as the cabinet tour,
 * separate storage key so the admin and cabinet "seen" flags are independent.
 *
 * Wave 1 (аудит G9-23): тексты переписаны под то, что реально есть на
 * телефоне. Раньше тур обещал «выручку и новых юзеров» на дашборде,
 * «назначить специалистом» в юзерах и подтверждение для всех операций,
 * пропускал вкладку «Брони» и вёл к «Кабинетам», которых нет в меню.
 * Счётчик «1 из 6» при 7 полосках убран — положение показывают полоски.
 * Префикс не меняли: тур не всплывёт заново у тех, кто его уже видел.
 */
const ADMIN_STEPS: Step[] = [
    {
        icon: Compass,
        title: 'Админка на телефоне',
        pill: 'Знакомство',
        body: (
            <>
                Здесь — <b>ежедневная работа администратора</b>: брони на сегодня,
                заявки, задачи, касса и клиенты. За полминуты покажем, что где.
            </>
        ),
    },
    {
        icon: BarChart3,
        title: 'Сегодня',
        pill: 'Сегодня',
        targetSelector: 'a[href="/m/admin/dashboard"]',
        body: (
            <>
                <b>Кто придёт и кто должен</b>: сверху «Взять сегодня» — сколько и
                с кого, ниже брони дня. Неоплаченные выделены красным «к оплате».
                «Должны» — список с кнопкой <b>«Принять оплату»</b>.
            </>
        ),
    },
    {
        icon: CalendarDays,
        title: 'Брони',
        pill: 'Брони',
        targetSelector: 'a[href="/m/admin/bookings"]',
        body: (
            <>
                Все брони по дням с поиском по имени и кабинету. Нажмите на бронь —
                её можно <b>перенести, продлить, поменять цену или отменить</b> с
                выбором возврата. Кнопка «+» — новая бронь за клиента.
            </>
        ),
    },
    {
        icon: CheckSquare,
        title: 'Задачи',
        pill: 'Команда',
        targetSelector: 'a[href="/m/admin/tasks"]',
        body: (
            <>
                <b>Задачи команды</b> с фильтрами «Мои», «Команда», «Просроченные».
                Статус меняется нажатием на плашку или свайпом. Регулярные задачи
                (уборка, проверки) создают следующую сами.
            </>
        ),
    },
    {
        icon: Wallet,
        title: 'Касса',
        pill: 'Касса',
        targetSelector: 'a[href="/m/admin/finance"]',
        body: (
            <>
                Сколько сейчас в кассе, итоги за день, неделю или месяц. Кнопка «+» —
                новая операция, ошибку можно «Вернуть» 5 секунд. Ниже —
                <b> «Закрыть смену»</b>.
            </>
        ),
    },
    {
        icon: Users,
        title: 'Клиенты и заявки',
        pill: 'Люди',
        targetSelector: 'a[href="/m/admin/users"]',
        body: (
            <>
                <b>Клиенты</b> — поиск, баланс и кнопка «＋₾», чтобы пополнить баланс
                прямо с телефона. <b>Заявки</b> (последняя вкладка) — срочные брони:
                одобрить или отклонить с причиной.
            </>
        ),
    },
    {
        icon: Inbox,
        title: 'Готово',
        pill: 'Всё',
        body: (
            <>
                «Админка ▾» сверху — переход в ваш личный кабинет, CRM клиентов и
                права доступа. Отмена брони, выключение кабинета и скрытие анкеты
                спрашивают подтверждение. Цены и анкеты удобнее менять на компьютере.
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
