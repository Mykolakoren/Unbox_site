/**
 * Статус абонемента для отображения — зеркалит backend
 * subscription_pool.lifecycle_status.
 *
 * Единый источник правды на фронте: и админская карточка, и клиентская
 * должны одинаково понимать «активен / на паузе / завершён», иначе UI
 * покажет истёкший абонемент как активный (ровно это и было до 2026-07-15).
 *
 * Реальный денежный гейт живёт на бэкенде (is_active). Здесь — только показ.
 */

export type SubLifecycle = 'active' | 'frozen' | 'completed' | 'none';

interface SubLike {
  isFrozen?: boolean;
  flexible?: boolean;
  expiryDate?: string;
  status?: string;
}

export function subscriptionLifecycle(
  sub: SubLike | null | undefined,
  now: Date = new Date(),
): SubLifecycle {
  if (!sub) return 'none';
  if (sub.isFrozen) return 'frozen';
  // Особые условия (Светлана) — срок не действует, всегда активен.
  if (sub.flexible) return 'active';
  if (sub.expiryDate) {
    const expiry = new Date(sub.expiryDate);
    if (!isNaN(expiry.getTime()) && now > expiry) return 'completed';
  }
  return 'active';
}

/** Плашка статуса: подпись + tailwind-классы. */
export function subscriptionBadge(sub: SubLike | null | undefined): {
  label: string;
  cls: string;
} {
  switch (subscriptionLifecycle(sub)) {
    case 'frozen':
      return { label: 'Заморожен', cls: 'bg-blue-200 text-blue-800' };
    case 'completed':
      return { label: 'Завершён', cls: 'bg-gray-200 text-gray-600' };
    default:
      return { label: 'Активен', cls: 'bg-green-200 text-green-800' };
  }
}
