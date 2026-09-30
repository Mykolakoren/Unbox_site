import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, Menu, X, ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import { useUserStore } from '../store/userStore';
import { COLOR } from '../design/tokens';
export interface NavItem {
    path: string;
    icon: React.ElementType;
    label: string;
    exact?: boolean;
}

interface SidebarLayoutProps {
    children: React.ReactNode;
    navItems: NavItem[];
    title?: string;
    customTopContent?: React.ReactNode;
    customBottomContent?: React.ReactNode;
}

export function SidebarLayout({ children, navItems, customTopContent, customBottomContent }: SidebarLayoutProps) {
    const location = useLocation();
    const logout = useUserStore(s => s.logout);
    const currentUser = useUserStore(s => s.currentUser);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const isActive = (path: string, exact?: boolean) => {
        if (exact) return location.pathname === path;
        // Exception for dashboard root so it doesn't match everything
        if (path === '/dashboard' && location.pathname !== '/dashboard') return false; 
        return location.pathname.startsWith(path);
    };

    const handleLogout = () => {
        logout();
        window.location.href = '/login';
    };

    return (
        <div className="min-h-screen flex text-ink relative">
            {/* Grid House paper background — the only theme now. */}
            <div className="fixed inset-0 z-0" style={{ background: COLOR.paper }} />

            {/* Sidebar (Desktop) */}
            <aside className="w-64 hidden md:flex flex-col fixed h-full z-10 rounded-r-3xl my-2 ml-2"
                style={{
                    background: 'rgba(255,255,255,0.92)',
                    border: '1px solid rgba(0,0,0,0.06)',
                    boxShadow: '4px 0 24px rgba(0,0,0,0.04)',
                }}>
                <div className="p-6 border-b border-unbox-light/50 flex items-center justify-center">
                    <Link to="/" className="group">
                        <img src="/unbox-logo.png" alt="Unbox" className="h-[50px] sm:h-[81px] object-contain cursor-pointer group-hover:scale-[1.15] transition-transform duration-200" />
                    </Link>
                </div>

                <div className="px-4 py-4 mb-2">
                    {currentUser && (
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-accent text-on-accent flex items-center justify-center font-semibold">
                                {currentUser.name?.[0]?.toUpperCase() ?? '?'}
                            </div>
                            <div className="overflow-hidden">
                                <div className="font-semibold text-sm truncate">{currentUser.name}</div>
                                <div className="text-xs text-ink-60 font-medium capitalize truncate">{currentUser.role === 'admin' || currentUser.role === 'senior_admin' || currentUser.role === 'owner' ? 'Администратор' : `Уровень: ${currentUser.level}`}</div>
                            </div>
                        </div>
                    )}
                </div>

                {customTopContent && <div className="px-4 mb-2">{customTopContent}</div>}

                <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto custom-scrollbar">
                    {navItems.map((item) => {
                        const active = isActive(item.path, item.exact);
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={clsx(
                                    "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 font-medium text-[13px] relative",
                                    active
                                        ? "bg-accent text-on-accent"
                                        : "text-ink-60 hover:bg-white/60 hover:text-ink"
                                )}
                            >
                                <item.icon size={17} className={active ? "text-on-accent" : "text-ink-60"} aria-hidden="true" />
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-unbox-light/50">
                    {customBottomContent && <div className="mb-4">{customBottomContent}</div>}
                    
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 px-3 py-2 rounded-xl transition-colors font-medium text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)] w-full text-left"
                    >
                        <LogOut size={18} />
                        Выйти
                    </button>
                    <Link to="/" className="flex items-center gap-3 px-3 py-2 mt-2 text-sm text-ink-60 hover:text-ink premium-transition">
                        <ArrowLeft size={16} /> На сайт
                    </Link>
                </div>
            </aside>

            {/* Mobile Header */}
            <header className="md:hidden fixed top-0 left-0 right-0 h-16 glass z-20 flex items-center justify-between px-4 border-b border-unbox-light/50">
                <Link to="/" className="group">
                    <img src="/unbox-logo.png" alt="Unbox" className="h-[44px] object-contain group-hover:scale-[1.15] transition-transform duration-200" />
                </Link>
                <button
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    aria-label={isMobileMenuOpen ? 'Закрыть меню' : 'Открыть меню'}
                    className="w-11 h-11 -mr-2 flex items-center justify-center text-ink bg-card rounded-lg"
                >
                    {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
            </header>

            {/* Mobile Sidebar Overlay */}
            {isMobileMenuOpen && (
                <div className="fixed inset-0 z-30 bg-unbox-dark/20 backdrop-blur-sm md:hidden premium-transition" onClick={() => setIsMobileMenuOpen(false)} />
            )}

            {/* Mobile Sidebar Navigation */}
            <div className={clsx(
                "fixed inset-y-0 left-0 w-72 bg-white/95 backdrop-blur-xl z-40 transform transition-transform duration-400 cubic-bezier(0.16, 1, 0.3, 1) md:hidden flex flex-col border-r border-unbox-light shadow-2xl",
                isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                <div className="p-6 border-b border-unbox-light/50 flex items-center justify-between">
                    <Link to="/" onClick={() => setIsMobileMenuOpen(false)} className="group">
                        <img src="/unbox-logo.png" alt="Unbox" className="h-[50px] object-contain group-hover:scale-[1.15] transition-transform duration-200" />
                    </Link>
                    <button onClick={() => setIsMobileMenuOpen(false)} aria-label="Закрыть меню" className="w-11 h-11 flex items-center justify-center bg-sunken rounded-full text-ink-60">
                        <X size={18} />
                    </button>
                </div>

                {customTopContent && <div className="px-4 pt-2">{customTopContent}</div>}

                <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                    {navItems.map((item) => (
                        <Link
                            key={item.path}
                            to={item.path}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={clsx(
                                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-sm",
                                isActive(item.path, item.exact)
                                    ? "bg-accent text-on-accent"
                                    : "text-ink-60 hover:bg-unbox-light/50 hover:text-ink"
                            )}
                        >
                            <item.icon size={18} />
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <div className="p-6 border-t border-unbox-light/50 bg-unbox-light/30">
                    {customBottomContent && <div className="mb-4">{customBottomContent}</div>}
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors font-medium text-sm text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)] w-full text-left bg-card"
                    >
                        <LogOut size={18} />
                        Выйти
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <main className="flex-1 md:ml-[272px] p-4 pt-24 md:pt-8 md:p-8 md:pr-10 w-full min-w-0 relative z-10">
                <div className="max-w-6xl mx-auto">
                    {children}
                </div>
            </main>
        </div>
    );
}
