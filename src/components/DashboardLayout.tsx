import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { Layout } from '../components/Layout';
import { Calendar, LogOut, Settings, LayoutDashboard, Home } from 'lucide-react';
import clsx from 'clsx';
import { useEffect } from 'react';

export function DashboardLayout() {
    const { currentUser, logout } = useUserStore();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (!currentUser) {
            navigate('/login');
        }
    }, [currentUser, navigate]);

    if (!currentUser) return null;

    const navItems = [
        { icon: LayoutDashboard, label: 'Обзор', path: '/dashboard' },
        { icon: Calendar, label: 'Мои бронирования', path: '/dashboard/bookings' },
        { icon: Settings, label: 'Настройки', path: '/dashboard/profile' },
        { icon: Home, label: 'На главную', path: '/' },
    ];

    return (
        <Layout>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                {/* Sidebar Navigation */}
                <div className="md:col-span-1 space-y-2">
                    <div className="bg-white p-4 rounded-xl border border-gray-200 mb-4 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center font-bold">
                            {currentUser.name[0].toUpperCase()}
                        </div>
                        <div>
                            <div className="font-bold text-sm">{currentUser.name}</div>
                            <div className="text-xs text-gray-500 capitalize">{currentUser.level} Member</div>
                        </div>
                    </div>

                    <nav className="space-y-1">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.path || (item.path !== '/dashboard' && location.pathname.startsWith(item.path));
                            return (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    className={clsx(
                                        "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                                        isActive
                                            ? "bg-black text-white"
                                            : "text-gray-600 hover:bg-gray-100"
                                    )}
                                >
                                    <Icon size={18} />
                                    {item.label}
                                </Link>
                            );
                        })}

                        <button
                            onClick={() => {
                                logout();
                                navigate('/login');
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                        >
                            <LogOut size={18} />
                            Выйти
                        </button>
                    </nav>
                </div>

                {/* Main Content Area */}
                <div className="md:col-span-3">
                    <Outlet />
                </div>
            </div>
        </Layout>
    );
}
