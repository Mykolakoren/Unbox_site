import { Outlet, useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { SidebarLayout } from './SidebarLayout';
import { Calendar, Settings, LayoutDashboard, ShieldCheck, BriefcaseMedical, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { hasPermission } from '../utils/permissions';

export function DashboardLayout() {
    const { currentUser, fetchCurrentUser } = useUserStore();
    const navigate = useNavigate();
    const [authChecked, setAuthChecked] = useState(false);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) {
            // No token at all → go to login immediately
            navigate('/login');
            return;
        }
        if (currentUser) {
            // User already loaded (from persist or previous fetch)
            setAuthChecked(true);
            return;
        }
        // Token exists but user not loaded yet → fetch and wait
        fetchCurrentUser()
            .then(() => setAuthChecked(true))
            .catch(() => {
                // Token invalid → interceptor clears it, redirect
                localStorage.removeItem('token');
                navigate('/login');
            });
    }, [currentUser, navigate, fetchCurrentUser]);

    // Still loading user from token
    if (!currentUser) {
        if (!authChecked && localStorage.getItem('token')) {
            return (
                <div className="flex items-center justify-center min-h-screen bg-gray-50/80">
                    <Loader2 className="w-8 h-8 animate-spin text-unbox-green" />
                </div>
            );
        }
        return null;
    }

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
