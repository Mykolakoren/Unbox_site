import { Outlet } from 'react-router-dom';
import { LayoutDashboard, Calendar, Users, Clock, Box, BookOpen, ClipboardList } from 'lucide-react';
import { IntegrationStatus } from '../../components/admin/IntegrationStatus';

import { SidebarLayout } from '../../components/SidebarLayout';

export function AdminLayout() {

    const navItems = [
        { path: '/admin', icon: LayoutDashboard, label: 'Обзор', exact: true },
        { path: '/admin/cabinets', icon: Box, label: 'Кабинеты' },
        { path: '/admin/bookings', icon: Calendar, label: 'Бронирования' },
        { path: '/admin/users', icon: Users, label: 'Клиенты' },
        { path: '/admin/waitlist', icon: Clock, label: 'Лист ожидания' },
        { path: '/admin/tasks', icon: ClipboardList, label: 'Задачи' },
        { path: '/admin/knowledge-base', icon: BookOpen, label: 'База данных' },
    ];

    return (
        <SidebarLayout 
            navItems={navItems}
            customBottomContent={<IntegrationStatus />}
        >
            <Outlet />
        </SidebarLayout>
    );
}
