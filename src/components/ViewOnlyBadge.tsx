import { useLocation } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { FONT, Z } from '../design/tokens';

/**
 * Плашка «Только просмотр» в админке (владелец 21.11.2026).
 *
 * После переезда администратор на сайте один. Тем, кому оставлен только
 * просмотр (User.viewOnlyFrom), сервер отклоняет любые изменения, кроме своих
 * броней и профиля (services/staff_scope.py). Без плашки человек узнавал бы об
 * этом только по ошибке после нажатия кнопки.
 */
function todayYmd(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ViewOnlyBadge() {
    const user = useUserStore(s => s.currentUser);
    const { pathname } = useLocation();
    const inAdmin = pathname.startsWith('/admin') || pathname.startsWith('/m/admin');
    const isStaff = user?.role === 'admin' || user?.role === 'senior_admin';
    const from = user?.viewOnlyFrom?.slice(0, 10);
    if (!inAdmin || !isStaff || !from || todayYmd() < from) return null;
    return (
        <div
            role="status"
            className="fixed left-3 bottom-24 md:bottom-3 max-w-[calc(100%-24px)] pointer-events-none"
            style={{ zIndex: Z.toast, fontFamily: FONT.sans }}
        >
            <div
                className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-md"
                style={{ background: '#FFEDD5', color: '#7C2D12' }}
            >
                <Eye size={14} aria-hidden="true" />
                <span>Только просмотр: менять можно свои брони и профиль</span>
            </div>
        </div>
    );
}
