import { User as UserIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { useBookingStore } from '../store/bookingStore';
import { Button } from './ui/Button';

export function Layout({ children }: { children: React.ReactNode }) {
    const user = useUserStore((s) => s.currentUser);

    return (
        <div className="min-h-screen bg-unbox-light text-unbox-dark font-sans selection:bg-unbox-green selection:text-white">
            {/* Header */}
            <header className="sticky top-0 z-50 w-full border-b border-unbox-light bg-white/80 backdrop-blur-md text-unbox-dark">
                <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                    <Link
                        to="/"
                        className="flex items-center gap-2 group"
                        onClick={() => useBookingStore.getState().reset()}
                    >
                        <img src="/unbox-logo.png" alt="Unbox" className="h-12 object-contain cursor-pointer group-hover:opacity-80 transition-opacity" />
                    </Link>

                    <div className="flex items-center gap-4">
                        {user ? (
                            <Link to="/dashboard" className="flex items-center gap-2 hover:bg-gray-100 p-1.5 rounded-lg transition-colors">
                                <div className="hidden sm:block text-right">
                                    <div className="text-sm font-bold leading-none">{user.name}</div>
                                    <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">{user.level}</div>
                                </div>
                                <div className="w-8 h-8 bg-black text-white rounded-full flex items-center justify-center font-bold text-xs">
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
            <footer className="border-t border-gray-200 bg-white py-8 mt-auto">
                <div className="container mx-auto px-4 text-center text-gray-400 text-sm">
                    &copy; {new Date().getFullYear()} Unbox. All rights reserved.
                </div>
            </footer>
        </div>
    );
}
