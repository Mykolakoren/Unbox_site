import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Calendar, Users, LogOut, Clock } from 'lucide-react';
import clsx from 'clsx';
import { useUserStore } from '../../store/userStore';

export function AdminLayout() {
    const location = useLocation();
    const logout = useUserStore(s => s.logout);

    const navItems = [
        { path: '/admin', icon: LayoutDashboard, label: 'Обзор', exact: true },
        { path: '/admin/bookings', icon: Calendar, label: 'Бронирования' },
        { path: '/admin/users', icon: Users, label: 'Клиенты' },
        { path: '/admin/waitlist', icon: Clock, label: 'Лист ожидания' },
    ];

    const isActive = (path: string, exact: boolean) => {
        if (exact) return location.pathname === path;
        return location.pathname.startsWith(path);
    };

    return (
        <div className="min-h-screen bg-unbox-light flex text-unbox-dark">
            {/* Sidebar */}
            <aside className="w-64 bg-white border-r border-unbox-light hidden md:flex flex-col fixed h-full z-10">
                <div className="p-6 border-b border-unbox-light flex items-center justify-center">
                    <Link to="/">
                        <img src="/src/assets/unbox-logo.png" alt="Unbox" className="h-12 object-contain cursor-pointer hover:opacity-80 transition-opacity" />
                    </Link>
                </div>

                <nav className="flex-1 p-4 space-y-1">
                    {navItems.map((item) => (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={clsx(
                                "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors font-medium",
                                isActive(item.path, !!item.exact)
                                    ? "bg-unbox-green text-white shadow-sm"
                                    : "text-unbox-grey hover:bg-unbox-light hover:text-unbox-dark"
                            )}
                        >
                            <item.icon size={20} />
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <div className="p-4 border-t border-gray-100">
                    <button
                        onClick={() => {
                            logout();
                            window.location.href = '/';
                        }}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors font-medium text-red-500 hover:bg-red-50 w-full text-left"
                    >
                        <LogOut size={20} />
                        Выйти
                    </button>
                    <Link to="/" className="flex items-center gap-3 px-3 py-2 mt-2 text-sm text-gray-500 hover:text-black">
                        ← Вернуться на сайт
                    </Link>
                </div>
            </aside>

            {/* Mobile Header (TODO) */}

            {/* Main Content */}
            <main className="flex-1 md:ml-64 p-8 overflow-y-auto">
                <Outlet />
            </main>
        </div>
    );
}
