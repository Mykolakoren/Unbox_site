import { lazy, Suspense } from 'react';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { SkeletonList } from '../../../components/ui/Skeleton';

const AdminAccessRights = lazy(() => import('../../admin/AccessRights').then(m => ({ default: m.AdminAccessRights })));

/**
 * «Права доступа» на телефоне (G8-21, G8-admin-ops-M4): та же страница, что
 * на компьютере, но в обёртке с полями 16 px и мобильной шапкой — раньше
 * текст и рамки начинались прямо от края экрана. Вход — из меню «Админка ▾»
 * для владельца и старшего админа.
 */
export function MobileAdminAccessRights() {
    return (
        <div style={{ padding: '0 16px 24px', overflowX: 'hidden' }}>
            <MobilePageHeader title="Права доступа" fallbackTo="/m/admin/dashboard" />
            <Suspense fallback={<SkeletonList count={4} label="Загружаем права" cardHeight={56} />}>
                <AdminAccessRights />
            </Suspense>
        </div>
    );
}
