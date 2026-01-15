import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Calendar, Users, LogOut, Clock, Menu, X, Box } from 'lucide-react';
import clsx from 'clsx';
import { useUserStore } from '../../store/userStore';
import { IntegrationStatus } from '../../components/admin/IntegrationStatus';

export function AdminLayout() {
    const location = useLocation();
    const logout = useUserStore(s => s.logout);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const navItems = [
        { path: '/admin', icon: LayoutDashboard, label: 'Обзор', exact: true },
        { path: '/admin/cabinets', icon: Box, label: 'Кабинеты' },
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
                        <img src="/unbox-logo.png" alt="Unbox" className="h-12 object-contain cursor-pointer hover:opacity-80 transition-opacity" />
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
                    <div className="mb-4">
                        <IntegrationStatus />
                    </div>
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

            {/* Mobile Header */}
            <header className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-unbox-light z-20 flex items-center justify-between px-4">
                <Link to="/">
                    <img src="/unbox-logo.png" alt="Unbox" className="h-8 object-contain" />
                </Link>
                <button
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    className="p-2 -mr-2 text-unbox-dark"
                >
                    {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
            </header>

            {/* Mobile Sidebar Overlay */}
            {isMobileMenuOpen && (
                <div className="fixed inset-0 z-10 bg-black/50 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />
            )}

            {/* Mobile Sidebar Navigation */}
            <div className={clsx(
                "fixed inset-y-0 left-0 w-64 bg-white z-20 transform transition-transform duration-300 ease-in-out md:hidden flex flex-col border-r border-unbox-light",
                isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                <div className="p-6 border-b border-unbox-light flex items-center justify-center">
                    <Link to="/" onClick={() => setIsMobileMenuOpen(false)}>
                        <img src="/unbox-logo.png" alt="Unbox" className="h-10 object-contain" />
                    </Link>
                </div>

                <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                    {navItems.map((item) => (
                        <Link
                            key={item.path}
                            to={item.path}
                            onClick={() => setIsMobileMenuOpen(false)}
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
                    <div className="mb-4">
                        <IntegrationStatus />
                    </div>
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
                    <Link
                        to="/"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="flex items-center gap-3 px-3 py-2 mt-2 text-sm text-gray-500 hover:text-black"
                    >
                        ← Вернуться на сайт
                    </Link>
                </div>
            </div>

            {/* Main Content */}
            {/* Main Content */}
            <main className="flex-1 md:ml-64 p-4 pt-20 md:p-8 overflow-y-auto">
                <Outlet />
            </main>
        </div>
    );
}
