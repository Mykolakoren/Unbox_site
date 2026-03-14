import { Outlet, useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { SidebarLayout } from './SidebarLayout';
import { Calendar, Settings, LayoutDashboard, ShieldCheck, BriefcaseMedical } from 'lucide-react';
import { useEffect } from 'react';
import { hasPermission } from '../utils/permissions';

export function DashboardLayout() {
    const { currentUser } = useUserStore();
    const navigate = useNavigate();

    useEffect(() => {
        if (!currentUser) {
            navigate('/login');
        }
    }, [currentUser, navigate]);

    if (!currentUser) return null;

    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'senior_admin' || currentUser.role === 'owner';
    const hasCrm = hasPermission(currentUser, 'psy_crm.access');

    const navItems = [
        { icon: LayoutDashboard, label: 'Обзор', path: '/dashboard' },
        { icon: Calendar, label: 'Мои бронирования', path: '/dashboard/bookings' },
        ...(hasCrm ? [{ icon: BriefcaseMedical, label: 'Мой CRM', path: '/crm' }] : []),
        { icon: Settings, label: 'Настройки', path: '/dashboard/profile' },
        ...(isAdmin ? [{ icon: ShieldCheck, label: 'Админ-панель', path: '/admin' }] : []),
    ];

    return (
        <SidebarLayout navItems={navItems}>
            <Outlet />
        </SidebarLayout>
    );
}
