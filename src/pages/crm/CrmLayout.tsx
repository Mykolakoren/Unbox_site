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
    Loader2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { CrmApplyPage } from './CrmApplyPage';
import { crmApi, type CrmAccessStatus } from '../../api/crm';
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
    const [accessStatus, setAccessStatus] = useState<CrmAccessStatus | null>(null);
    const [accessLoading, setAccessLoading] = useState(true);

    useEffect(() => {
        if (!hasToken) navigate('/login');
    }, [hasToken, navigate]);

    // Check CRM access via API
    useEffect(() => {
        if (!currentUser) return;

        // Quick check: specialist and owner always have access
        const hasRoleAccess = currentUser.role === 'specialist' || currentUser.role === 'owner';
        if (hasRoleAccess) {
            setAccessStatus({ access_status: 'active', permanent: true, expires_at: null, days_remaining: null });
            setAccessLoading(false);
            return;
        }

        crmApi.getMyAccess()
            .then(setAccessStatus)
            .catch(() => setAccessStatus({ access_status: 'none', permanent: false, expires_at: null, days_remaining: null }))
            .finally(() => setAccessLoading(false));
    }, [currentUser]);

    if (!hasToken) return <Navigate to="/login" replace />;
    if (!currentUser) return null;

    // Show loading while checking access
    if (accessLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50/80">
                <Loader2 className="w-8 h-8 animate-spin text-unbox-green" />
            </div>
        );
    }

    // Show apply page if no active access
    if (!accessStatus || accessStatus.access_status !== 'active') {
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
