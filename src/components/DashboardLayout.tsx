import { Outlet, useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { SidebarLayout } from './SidebarLayout';
import { Calendar, Settings, LayoutDashboard, ShieldCheck, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CrmAccessToggle } from './CrmAccessToggle';

export function DashboardLayout() {
    const { currentUser, fetchCurrentUser } = useUserStore();
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) {
            navigate('/login');
            return;
        }
        if (currentUser) {
            setIsLoading(false);
            return;
        }
        fetchCurrentUser()
            .then(() => setIsLoading(false))
            .catch(() => {
                localStorage.removeItem('token');
                navigate('/login');
            });
    }, [currentUser, navigate, fetchCurrentUser]);

    if (isLoading || !currentUser) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50/80">
                <Loader2 className="w-8 h-8 animate-spin text-unbox-green" />
            </div>
        );
    }

    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'senior_admin' || currentUser.role === 'owner';

    const navItems = [
        { icon: LayoutDashboard, label: 'Обзор', path: '/dashboard' },
        { icon: Calendar, label: 'Мои бронирования', path: '/dashboard/bookings' },
        { icon: Settings, label: 'Настройки', path: '/dashboard/profile' },
        ...(isAdmin ? [{ icon: ShieldCheck, label: 'Админ-панель', path: '/admin' }] : []),
    ];

    return (
        <SidebarLayout navItems={navItems} customTopContent={<CrmAccessToggle />}>
            <Outlet />
        </SidebarLayout>
    );
}
