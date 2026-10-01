import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { useUserStore } from '../../../store/userStore';
import { userCanAccessRights } from '../../../utils/permissions';

const AdminAccessRights = lazy(() => import('../../admin/AccessRights').then(m => ({ default: m.AdminAccessRights })));

/**
 * «Права доступа» на телефоне (G8-21, G8-admin-ops-M4): та же страница, что
 * на компьютере, но в обёртке с полями 16 px и мобильной шапкой — раньше
 * текст и рамки начинались прямо от края экрана. Вход — из меню «Админка ▾»
 * для владельца и старшего админа.
 *
 * Волна 4 (доработка): по прямой ссылке без роли owner / senior_admin —
 * обратно в «Сегодня» (та же userCanAccessRights, что прячет пункт меню).
 * Компьютерная страница идёт с embedded: H1 уже есть в мобильной шапке,
 * второго заголовка внутри не рисуем.
 */
export function MobileAdminAccessRights() {
    const currentUser = useUserStore(s => s.currentUser);
    if (!currentUser) return null;
    if (!userCanAccessRights(currentUser)) return <Navigate to="/m/admin/dashboard" replace />;
    return (
        <div style={{ padding: '0 16px 24px', overflowX: 'hidden' }}>
            <MobilePageHeader title="Права доступа" fallbackTo="/m/admin/dashboard" />
            <Suspense fallback={<SkeletonList count={4} label="Загружаем права" cardHeight={56} />}>
                <AdminAccessRights embedded deniedTo="/m/admin/dashboard" />
            </Suspense>
        </div>
    );
}
