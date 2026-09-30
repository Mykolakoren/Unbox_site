import { useEffect, useState } from 'react';
import { specialistsApi, type SpecialistProfile } from '../api/specialists';
import { useUserStore } from '../store/userStore';

/**
 * Статус анкеты специалиста для тех, кто ещё не может бронировать
 * (role 'user'). Экраны брони показывают по нему карточку: «заполните
 * анкету» или «анкета на проверке».
 *
 * Источник — GET /specialists/me: 404 = анкеты нет, иначе её статус.
 * Старый бэкенд отвечает на этот запрос ролям 'user' 403 — тогда опираемся
 * на пометку этого устройства, что анкета уже отправлена.
 */
export type SpecialistApplicationStatus = 'none' | 'pending' | 'approved' | 'rejected';

const sentKey = (userId: string) => `unbox:specialist-application-sent:${userId}`;
// Ответ сервера на сессию вкладки: переходы между экранами не мигают карточкой.
const known = new Map<string, SpecialistApplicationStatus>();

/**
 * Анкета → статус. Одно правило для карточки на экранах брони и для самой
 * страницы анкеты (волна 2, E): раньше страница решала по-своему.
 * Одобрена = проверена админом (is_verified) или статус approved. Старые
 * анкеты, заведённые админом без статуса и без проверки, считаем «на проверке».
 */
export function applicationStatusOf(profile: SpecialistProfile | null | undefined): SpecialistApplicationStatus {
    if (!profile) return 'none';
    if (profile.isVerified || profile.applicationStatus === 'approved') return 'approved';
    if (profile.applicationStatus === 'rejected') return 'rejected';
    return 'pending';
}

/**
 * Причина отказа, если сервер её отдаёт. Сейчас «Отклонить» в админке
 * причину не сохраняет — поле читаем про запас под любым из привычных имён,
 * чтобы экран показал её, как только сервер начнёт её присылать.
 */
export function applicationRejectReason(profile: SpecialistProfile | null | undefined): string | null {
    if (!profile) return null;
    const p = profile as SpecialistProfile & Record<string, unknown>;
    for (const key of ['rejectionReason', 'rejectReason', 'reviewComment', 'adminComment']) {
        const v = p[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
}

/** Страница анкеты узнала свежий статус — карточки на экранах брони
 *  берут его сразу, без своего запроса и без мигания. */
export function rememberSpecialistApplicationStatus(userId: string | undefined, status: SpecialistApplicationStatus) {
    if (!userId) return;
    known.set(userId, status);
}

/** После успешной отправки анкеты: запоминаем на устройстве и в памяти. */
export function markSpecialistApplicationSent(userId: string | undefined) {
    if (!userId) return;
    known.set(userId, 'pending');
    try { localStorage.setItem(sentKey(userId), '1'); } catch { /* приватный режим */ }
}

function sentOnThisDevice(userId: string): boolean {
    try { return localStorage.getItem(sentKey(userId)) === '1'; } catch { return false; }
}

function initialStatus(userId: string | undefined): SpecialistApplicationStatus {
    if (!userId) return 'none';
    return known.get(userId) ?? (sentOnThisDevice(userId) ? 'pending' : 'none');
}

/** `enabled` — только для тех, кто не может бронировать: остальным запрос не нужен. */
export function useSpecialistApplicationStatus(
    user: { id?: string } | null | undefined,
    enabled: boolean,
): SpecialistApplicationStatus {
    const userId = user?.id;
    const [status, setStatus] = useState<SpecialistApplicationStatus>(() => initialStatus(userId));

    useEffect(() => {
        if (!enabled || !userId) return;
        setStatus(initialStatus(userId));
        let cancelled = false;
        specialistsApi.getMine()
            .then(profile => {
                const next = applicationStatusOf(profile);
                known.set(userId, next);
                if (!cancelled) setStatus(next);
                // Анкету одобрили, а роль в сохранённом профиле старая —
                // перечитываем профиль: если доступ уже открыт, карточка уйдёт.
                if (next === 'approved') useUserStore.getState().fetchCurrentUser().catch(() => {});
            })
            .catch(() => { /* 403 на старом бэкенде — остаёмся на пометке устройства */ });
        return () => { cancelled = true; };
    }, [enabled, userId]);

    return status;
}
