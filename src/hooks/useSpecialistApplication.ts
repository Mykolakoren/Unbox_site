import { useEffect, useState } from 'react';
import { specialistsApi } from '../api/specialists';
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
                const next: SpecialistApplicationStatus = !profile
                    ? 'none'
                    : profile.isVerified || profile.applicationStatus === 'approved'
                        ? 'approved'
                        : profile.applicationStatus === 'rejected' ? 'rejected' : 'pending';
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
