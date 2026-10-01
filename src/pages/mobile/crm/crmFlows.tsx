import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { crmApi, type CrmClient, type CrmSession } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { NewSessionSheet } from '../../../components/crm/NewSessionSheet';
import { undoToast } from '../../../components/ui/undoToast';
import { toastApiError } from '../../../utils/errors';
import { formatDayMonthShort, formatMoney, formatWeekdayShort } from '../../../utils/format';
import { suggestNextSession, utcNaiveToTbilisi } from '../../../utils/crmNextSession';

/**
 * Общие сценарии мобильной CRM (волна 3, пакет A).
 *
 *  - useBookNext — «Записать следующую»: шторка NewSessionSheet со
 *    значениями прошлой сессии, после записи — свой тост
 *    «Записали · Забронировать кабинет» → /m/find?linkSession=… (тот же
 *    контракт, что «Привязать кабинет» в шторке сессии: id, date, time,
 *    duration по Батуми).
 *  - useQuickPay — оплата в один тап (решение В5): только quickPaySession
 *    из стора (там же защита _quickPayInFlight), тост на 5 с «Вернуть».
 *    «Вернуть» снимает отметку тем же путём, что снятие оплаты в шторке
 *    сессии (crmApi.unmarkPaidSession — платёж удаляется), но без вопроса:
 *    это отмена своего же действия.
 *
 * Время — только через utils/crmNextSession (Батуми), без toISOString.
 */

/** «вт, 7 окт.» — коротко, как в кнопке шторки NewSessionSheet. */
export function shortDay(ymd: string): string {
    return `${formatWeekdayShort(ymd, { capitalize: false })}, ${formatDayMonthShort(ymd)}`;
}

/** «вт, 7 окт., 19:00» — когда будет «следующая» после этой сессии. */
export function nextSessionLabel(
    lastSession: CrmSession | null | undefined,
    client: CrmClient | null | undefined,
): string {
    const s = suggestNextSession({ lastSession: lastSession ?? null, client: client ?? null });
    return `${shortDay(s.date)}, ${s.time}`;
}

/** Адрес «Забронировать кабинет» под сессию — контракт MobileFind
 *  (?linkSession=<id>&date=YYYY-MM-DD&time=HH:mm&duration=N, по Батуми). */
export function linkCabinetPath(session: CrmSession): string | null {
    const w = utcNaiveToTbilisi(session.date);
    if (!w) return null;
    const dur = session.durationMinutes || 60;
    return `/m/find?linkSession=${encodeURIComponent(session.id)}&date=${w.date}&time=${w.time}&duration=${dur}`;
}

interface BookNextState {
    client: CrmClient | null;
    /** undefined — шторка найдёт прошлую сессию сама. */
    lastSession?: CrmSession | null;
}

/**
 * «Записать следующую» / «+ Сессия». Возвращает open(client?, lastSession?)
 * и элемент шторки — его нужно отрендерить на экране.
 * onCreated — экран перечитывает свои данные (шторка стор не обновляет).
 */
export function useBookNext(onCreated: (session: CrmSession) => void, clients?: CrmClient[]) {
    const navigate = useNavigate();
    const [state, setState] = useState<BookNextState | null>(null);

    const open = useCallback((client?: CrmClient | null, lastSession?: CrmSession | null) => {
        setState({ client: client ?? null, lastSession });
    }, []);

    const handleCreated = (session: CrmSession) => {
        const w = utcNaiveToTbilisi(session.date);
        const name = (clients ?? []).find(c => c.id === session.clientId)?.name ?? state?.client?.name ?? '';
        const when = w ? `${shortDay(w.date)}, ${w.time}` : '';
        const path = linkCabinetPath(session);
        toast.success(`Записали${name ? `: ${name}` : ''}${when ? `, ${when}` : ''}`, {
            duration: 8000,
            action: path ? { label: 'Забронировать кабинет', onClick: () => navigate(path) } : undefined,
        });
        onCreated(session);
    };

    const sheet = (
        <NewSessionSheet
            open={!!state}
            onClose={() => setState(null)}
            onCreated={handleCreated}
            client={state?.client ?? undefined}
            clients={clients}
            lastSession={state?.client ? state.lastSession : undefined}
            successToast={false}
        />
    );

    return { open, sheet };
}

/**
 * Оплата в один тап (В5). pay(session) — отметить оплату (quickPaySession
 * из стора) и показать «Отмечено · Вернуть» на 5 с. onPatched — экран
 * подменяет сессию у себя (isPaid, цена), onSettled — перечитать данные.
 */
export function useQuickPay(
    onPatched: (session: CrmSession) => void,
    onSettled?: () => void,
) {
    const quickPaySession = useCrmStore(s => s.quickPaySession);
    // Защита от двойного тапа: ref срабатывает раньше перерисовки кнопки.
    const busyRef = useRef(new Set<string>());
    const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

    const setBusy = (id: string, on: boolean) => {
        if (on) busyRef.current.add(id); else busyRef.current.delete(id);
        setBusyIds(new Set(busyRef.current));
    };

    const undo = async (before: CrmSession) => {
        if (busyRef.current.has(before.id)) return;
        setBusy(before.id, true);
        try {
            await crmApi.unmarkPaidSession(before.id);
            onPatched({ ...before, isPaid: false });
            toast.success('Оплата снята');
        } catch (e) {
            toastApiError(e, 'Не удалось снять оплату. Попробуйте ещё раз');
        } finally {
            setBusy(before.id, false);
            onSettled?.();
        }
    };

    const pay = async (session: CrmSession) => {
        if (session.isPaid || busyRef.current.has(session.id)) return;
        setBusy(session.id, true);
        try {
            const res = await quickPaySession(session.id);
            onPatched({
                ...session,
                isPaid: true,
                price: res.amount ?? session.price,
                currency: res.currency ?? session.currency,
            });
            const money = res.amount ? ` · ${formatMoney(res.amount, { currency: res.currency || 'GEL' })}` : '';
            undoToast(`Отмечено${money}`, () => undo(session));
        } catch {
            // Тост об ошибке уже показал стор (quickPaySession).
        } finally {
            setBusy(session.id, false);
            onSettled?.();
        }
    };

    return { pay, busyIds };
}
