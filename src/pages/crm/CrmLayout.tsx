import { Outlet, useNavigate, Navigate } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { SidebarLayout } from '../../components/SidebarLayout';
import {
    LayoutDashboard,
    Users,
    Calendar,
    Wallet,
    StickyNote,
    Settings,
    ShieldCheck,
    ArrowLeft,
} from 'lucide-react';
import { useEffect } from 'react';

export function CrmLayout() {
    const { currentUser } = useUserStore();
    const navigate = useNavigate();
    const hasToken = Boolean(localStorage.getItem('token'));

    useEffect(() => {
        if (!hasToken) navigate('/login');
    }, [hasToken, navigate]);

    // No token → login
    if (!hasToken) return <Navigate to="/login" replace />;

    // Token but user loading
    if (!currentUser) return null;

    // Only specialists can access CRM — admins, users, owners are all blocked
    if (currentUser.role !== 'specialist') return <Navigate to="/" replace />;

    const navItems = [
        { icon: LayoutDashboard, label: 'Дашборд',  path: '/crm' },
        { icon: Users,           label: 'Клиенты',  path: '/crm/clients' },
        { icon: Calendar,        label: 'Сессии',   path: '/crm/sessions' },
        { icon: Wallet,          label: 'Финансы',  path: '/crm/finances' },
        { icon: StickyNote,      label: 'Заметки',  path: '/crm/notes' },
        { icon: Settings,        label: 'Настройки', path: '/dashboard/profile' },
    ];

    const customBottomContent = (
        <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-700 transition-colors w-full px-3 py-2"
        >
            <ArrowLeft size={16} />
            К бронированиям
        </button>
    );

    return (
        <SidebarLayout navItems={navItems} customBottomContent={customBottomContent}>
            <Outlet />
        </SidebarLayout>
    );
}
