import { Outlet, useNavigate, Navigate, useLocation, Link } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { SidebarLayout } from '../../components/SidebarLayout';
import {
    Settings,
    ArrowLeft,
    LayoutDashboard,
    Users,
    Calendar,
    Wallet,
    StickyNote,
} from 'lucide-react';
import { useEffect } from 'react';
import { hasPermission } from '../../utils/permissions';
import { CrmApplyPage } from './CrmApplyPage';
import clsx from 'clsx';

const CRM_TABS = [
    { icon: LayoutDashboard, label: 'Дашборд',  path: '/crm',          exact: true },
    { icon: Users,           label: 'Клиенты',  path: '/crm/clients' },
    { icon: Calendar,        label: 'Сессии',   path: '/crm/sessions' },
    { icon: Wallet,          label: 'Финансы',  path: '/crm/finances' },
    { icon: StickyNote,      label: 'Заметки',  path: '/crm/notes' },
];

function CrmTopTabs() {
    const location = useLocation();

    const isActive = (path: string, exact?: boolean) => {
        if (exact) return location.pathname === path;
        return location.pathname.startsWith(path);
    };

    return (
        <div className="mb-6 -mt-2">
            <nav className="flex gap-1 bg-white/70 backdrop-blur rounded-2xl p-1.5 border border-white/80 shadow-sm w-fit">
                {CRM_TABS.map(tab => {
                    const active = isActive(tab.path, tab.exact);
                    return (
                        <Link
                            key={tab.path}
                            to={tab.path}
                            className={clsx(
                                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
                                active
                                    ? 'bg-unbox-green text-white shadow-md shadow-unbox-green/25'
                                    : 'text-unbox-grey hover:text-unbox-dark hover:bg-unbox-light/60'
                            )}
                        >
                            <tab.icon size={15} />
                            <span>{tab.label}</span>
                        </Link>
                    );
                })}
            </nav>
        </div>
    );
}

export function CrmLayout() {
    const { currentUser } = useUserStore();
    const navigate = useNavigate();
    const hasToken = Boolean(localStorage.getItem('token'));

    useEffect(() => {
        if (!hasToken) navigate('/login');
    }, [hasToken, navigate]);

    if (!hasToken) return <Navigate to="/login" replace />;
    if (!currentUser) return null;

    if (!hasPermission(currentUser, 'crm.access')) {
        return <CrmApplyPage />;
    }

    // Sidebar shows only general items — CRM sections are in the top tabs
    const sidebarNavItems = [
        { icon: Settings, label: 'Настройки', path: '/dashboard/profile' },
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
        <SidebarLayout navItems={sidebarNavItems} customBottomContent={customBottomContent}>
            <CrmTopTabs />
            <Outlet />
        </SidebarLayout>
    );
}
