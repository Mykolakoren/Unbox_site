import { User as UserIcon, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { useBookingStore } from '../store/bookingStore';
import { LegacyButton as Button } from './ui/LegacyButton';

export function Layout({ children }: { children: React.ReactNode }) {
    const user = useUserStore((s) => s.currentUser);

    return (
        <div className="min-h-screen bg-paper text-ink font-sans selection:bg-accent selection:text-on-accent">
            {/* Header */}
            <header className="sticky top-0 z-50 w-full border-b border-ink-10 bg-paper text-ink">
                <div className="container mx-auto px-4 h-24 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <Link
                            to="/"
                            className="flex items-center group"
                            onClick={() => useBookingStore.getState().reset()}
                        >
                            <img src="/unbox-logo.png" alt="Unbox" className="h-[50px] sm:h-[81px] object-contain cursor-pointer group-hover:scale-[1.15] transition-transform duration-200" />
                        </Link>

                        <nav className="hidden md:flex items-center gap-1">
                            <Link to="/dashboard/bookings" className="px-3 py-2 rounded-lg font-medium text-sm text-ink-60 hover:text-ink hover:bg-unbox-light/50 transition-colors">
                                Забронировать
                            </Link>
                            <Link to="/#locations" className="px-3 py-2 rounded-lg font-medium text-sm text-ink-60 hover:text-ink hover:bg-unbox-light/50 transition-colors">
                                Кабинеты
                            </Link>
                            <Link to="/specialists" className="px-3 py-2 rounded-lg font-medium text-sm text-ink-60 hover:text-ink hover:bg-unbox-light/50 transition-colors">
                                Специалисты
                            </Link>
                        </nav>
                    </div>

                    <div className="flex items-center gap-4">
                        {user && (user.role === 'admin' || user.role === 'senior_admin' || user.role === 'owner') && (
                            <Link to="/admin">
                                <Button variant="ghost" size="sm" className="font-medium text-ink hover:text-accent-ink">
                                    <ShieldCheck size={18} className="mr-2" />
                                    Админ-панель
                                </Button>
                            </Link>
                        )}

                        {user ? (
                            <Link to="/dashboard" className="flex items-center gap-2 hover:bg-unbox-light/50 p-1.5 rounded-lg transition-colors">
                                <div className="hidden sm:block text-right">
                                    <div className="text-sm font-semibold leading-none">{user.name}</div>
                                    <div className="text-caption text-ink-60 font-medium uppercase tracking-[0.06em]">{user.level}</div>
                                </div>
                                <div className="w-8 h-8 bg-ink text-on-ink rounded-full flex items-center justify-center font-semibold text-xs">
                                    {user.name[0]?.toUpperCase()}
                                </div>
                            </Link>
                        ) : (
                            <Link to="/login">
                                <Button variant="ghost" size="sm" className="font-medium">
                                    <UserIcon size={18} className="mr-2" />
                                    Войти
                                </Button>
                            </Link>
                        )}
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="container mx-auto px-4 py-8 md:py-12">
                {children}
            </main>

            {/* Footer */}
            <footer className="border-t border-ink-10 bg-card py-8 mt-auto">
                <div className="container mx-auto px-4 text-center text-ink-60 text-sm">
                    &copy; {new Date().getFullYear()} Unbox
                </div>
            </footer>
        </div>
    );
}
