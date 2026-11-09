import { useOutletContext } from 'react-router-dom';

/** Что MobileCrmLayout передаёт экранам Psy-CRM через <Outlet context>. */
export interface MobileCrmOutletContext {
    /** Растёт, когда данные на сервере поменялись без участия экрана
     *  (прошедшие сессии автоматически закрылись → долги пересчитались). */
    crmDataVersion: number;
    /** 09.11: подключён ли Google Календарь. null — ещё не знаем (или не
     *  загрузилось): экраны ведут себя как раньше. */
    calendarConnected?: boolean | null;
    /** 09.11: открыть шторку «Календарь и счета» (подключение календаря). */
    openCalendarSetup?: () => void;
}

/** Номер «версии данных» Psy-CRM. Экран добавляет его в зависимости
 *  загрузки и сам перечитывает данные, когда номер меняется. Вне
 *  мобильной оболочки CRM — всегда 0. */
export function useCrmDataVersion(): number {
    const ctx = useOutletContext<MobileCrmOutletContext | null | undefined>();
    return ctx?.crmDataVersion ?? 0;
}

/** Календарь подключён? (null — неизвестно) и как открыть его подключение. */
export function useCrmCalendar(): { connected: boolean | null; openSetup: (() => void) | null } {
    const ctx = useOutletContext<MobileCrmOutletContext | null | undefined>();
    return { connected: ctx?.calendarConnected ?? null, openSetup: ctx?.openCalendarSetup ?? null };
}
