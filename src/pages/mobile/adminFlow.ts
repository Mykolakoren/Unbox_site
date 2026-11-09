import { create } from 'zustand';

/**
 * Админ-бронь / админ-перенос внутри клиентских экранов /m (ревью админки 09.11, №2).
 *
 * Админ из /m/admin жмёт «+ Бронь» или «Перенести» и попадает в клиентские
 * «Свободно» и «Оформление». Раньше там было клиентское нижнее меню, бронь по
 * умолчанию «за себя», а после переноса — уход в СВОИ «Мои брони».
 *
 * Признак режима (09.11, после ревизии): ссылка из админки несёт ?admin=1
 * («+ Бронь», «Перенести», бронь из карточки клиента). Флаг живёт в sessionStorage (переживает
 * перезагрузку страницы), снимается, как только человек уходит на любой
 * другой клиентский экран. Работает только для админов (isBookingAdmin).
 *
 * forName — для полоски «Бронь для: …»: ставят «Свободно» (перенос — владелец
 * брони) и «Оформление» (выбранный клиент).
 */
const KEY = 'unbox.m.adminBookingFlow';

function readFlag(): boolean {
    try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

interface AdminFlowState {
    active: boolean;
    forName: string | null;
    setActive: (v: boolean) => void;
    setForName: (name: string | null) => void;
}

export const useAdminFlow = create<AdminFlowState>((set) => ({
    active: readFlag(),
    forName: null,
    setActive: (v) => {
        try {
            if (v) sessionStorage.setItem(KEY, '1'); else sessionStorage.removeItem(KEY);
        } catch { /* приватный режим — живём без памяти между перезагрузками */ }
        set(v ? { active: true } : { active: false, forName: null });
    },
    setForName: (forName) => set({ forName }),
}));

/** Экраны, на которых идёт админ-бронь: «Свободно» и «Оформление». */
export function isAdminFlowPath(pathname: string): boolean {
    return /^\/m\/(find|checkout)\/?$/.test(pathname);
}
