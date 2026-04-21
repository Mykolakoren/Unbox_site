import { ArrowLeft, LogIn, LayoutDashboard } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useBookingStore } from '../store/bookingStore';
import { useUserStore } from '../store/userStore';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

interface MinimalLayoutProps {
    children: React.ReactNode;
    showBackButton?: boolean;
    onBack?: () => void;
    fullWidth?: boolean;
    noPadding?: boolean;
    glassMode?: boolean;
}

// ── Header style (post-Liquid Glass) ────────────────────────────────────────
const glassHeader: React.CSSProperties = {
    background: 'rgba(255,255,255,0.94)',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '0 1px 8px rgba(0,0,0,0.03)',
};
// ────────────────────────────────────────────────────────────────────────────

export function MinimalLayout({
    children,
    showBackButton = true,
    onBack,
    fullWidth = false,
    noPadding = false,
    glassMode = false,
}: MinimalLayoutProps) {
    const navigate = useNavigate();
    const resetBooking = useBookingStore(s => s.reset);
    const { currentUser } = useUserStore();

    const handleBack = () => {
        if (onBack) onBack();
        else navigate(-1);
    };

    // Grid House is the only design; glass header lives here.
    if (glassMode) {
        return (
            <div style={{ minHeight: '100vh', background: GH.paper, color: GH.ink, fontFamily: GH_SANS }}>
                {/* GH Header */}
                <header style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 50,
                    background: GH.paper,
                    borderBottom: `1px solid ${GH.ink8}`,
                }}>
                    <div style={{
                        maxWidth: fullWidth ? 1920 : 960,
                        margin: '0 auto',
                        padding: '14px 24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}>
                        {/* Left: back + logo */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            {showBackButton && (
                                <button
                                    onClick={handleBack}
                                    style={{
                                        width: 36, height: 36,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        border: `1px solid ${GH.ink10}`,
                                        borderRadius: 8,
                                        background: 'transparent',
                                        color: GH.ink60,
                                        cursor: 'pointer',
                                    }}
                                    aria-label="Go back"
                                >
                                    <ArrowLeft size={16} />
                                </button>
                            )}
                            <Link
                                to="/"
                                onClick={resetBooking}
                                style={{
                                    fontFamily: GH_MONO,
                                    fontSize: 15,
                                    fontWeight: 600,
                                    letterSpacing: '0.06em',
                                    color: GH.ink,
                                    textDecoration: 'none',
                                    textTransform: 'uppercase',
                                }}
                            >
                                Unbox
                            </Link>
                        </div>

                        {/* Right: Auth */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {!currentUser ? (
                                <Link
                                    to="/login"
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '8px 18px',
                                        background: GH.accent,
                                        color: '#fff',
                                        borderRadius: 8,
                                        fontSize: 13,
                                        fontWeight: 600,
                                        fontFamily: GH_SANS,
                                        textDecoration: 'none',
                                        letterSpacing: '0.01em',
                                    }}
                                >
                                    <LogIn size={14} />
                                    Войти
                                </Link>
                            ) : (
                                <button
                                    onClick={() => navigate('/dashboard')}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        padding: '6px 14px',
                                        background: GH.ink5,
                                        border: `1px solid ${GH.ink8}`,
                                        borderRadius: 8,
                                        cursor: 'pointer',
                                        fontFamily: GH_SANS,
                                        fontSize: 13,
                                        fontWeight: 500,
                                        color: GH.ink,
                                    }}
                                >
                                    <div style={{
                                        width: 28, height: 28,
                                        borderRadius: '50%',
                                        background: GH.accent,
                                        color: '#fff',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 12, fontWeight: 700,
                                    }}>
                                        {currentUser.name?.charAt(0).toUpperCase() ?? '·'}
                                    </div>
                                    <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {currentUser.name}
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>
                </header>

                {/* Main content */}
                <main style={{
                    minHeight: 'calc(100vh - 65px)',
                    paddingTop: 24,
                    paddingBottom: 40,
                    ...(noPadding ? {} : { paddingLeft: fullWidth ? 24 : 16, paddingRight: fullWidth ? 24 : 16 }),
                }}>
                    {children}
                </main>
            </div>
        );
    }

    // ── GLASS MODE (photo bg + floating glass pill header) ──────────────────
    if (glassMode) {
        return (
            <div className="min-h-screen font-sans text-unbox-dark selection:bg-unbox-green selection:text-white">

                {/* Background — photo layer for glass mode */}
                <div className="fixed inset-0 z-0">
                    <img src="/hero-bg.jpg" alt="" className="w-full h-full object-cover object-[center_45%]" />
                    <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.58)' }} />
                </div>

                {/* Floating glass header pill */}
                <header className="fixed top-0 left-0 right-0 z-50 px-4 md:px-8 pt-4">
                    <div
                        className={`flex items-center justify-between px-5 py-3 rounded-[22px] mx-auto ${fullWidth ? 'max-w-[1920px]' : 'max-w-4xl'}`}
                        style={glassHeader}
                    >
                        {/* Left: back button */}
                        <div className="flex-1 flex justify-start">
                            {showBackButton && (
                                <button
                                    onClick={handleBack}
                                    className="w-10 h-10 flex items-center justify-center rounded-full bg-white/50 hover:bg-white text-unbox-grey hover:text-unbox-dark transition-all shadow-sm backdrop-blur-sm border border-white/50"
                                    aria-label="Go back"
                                >
                                    <ArrowLeft size={18} />
                                </button>
                            )}
                        </div>

                        {/* Center: Logo */}
                        <div className="flex-1 flex justify-center">
                            <Link to="/" onClick={resetBooking} className="flex items-center group">
                                <img
                                    src="/unbox-logo.png"
                                    alt="Unbox"
                                    className="h-[50px] sm:h-[81px] object-contain drop-shadow-md group-hover:scale-[1.15] transition-transform duration-200"
                                />
                            </Link>
                        </div>

                        {/* Right: Auth */}
                        <div className="flex-1 flex justify-end">
                            {!currentUser ? (
                                <Link
                                    to="/login"
                                    className="flex items-center gap-2 px-4 py-2 rounded-full text-white text-sm font-semibold shadow-lg hover:-translate-y-0.5 transition-all bg-[#476D6B]"
                                >
                                    <LogIn size={15} />
                                    Войти
                                </Link>
                            ) : (
                                <button
                                    onClick={() => navigate('/dashboard')}
                                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-md border border-white/60 text-unbox-dark hover:bg-white transition-all text-sm font-medium shadow-md"
                                >
                                    <div
                                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 bg-[#476D6B]"
                                    >
                                        {currentUser.name?.charAt(0).toUpperCase() ?? <LayoutDashboard size={12} />}
                                    </div>
                                    <span className="max-w-[120px] truncate">{currentUser.name}</span>
                                </button>
                            )}
                        </div>
                    </div>
                </header>

                {/* Main content */}
                <main className={`relative z-10 min-h-screen pt-[132px] pb-10 ${noPadding ? '' : fullWidth ? 'px-6 md:px-12' : 'px-4 md:px-8'}`}>
                    {children}
                </main>
            </div>
        );
    }

    // ── DEFAULT MODE ────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-unbox-light text-unbox-dark font-sans selection:bg-unbox-green selection:text-white flex flex-col relative overflow-hidden">
            {/* Ambient Background decoration */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-unbox-green/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-unbox-dark/5 rounded-full blur-[100px] pointer-events-none" />

            {/* Header */}
            <header className="w-full relative z-10 pt-5 pb-2">
                <div className={`mx-auto ${fullWidth ? 'max-w-[1920px] w-full px-8' : 'container max-w-4xl px-4'} flex items-center justify-between`}>
                    {/* Left: back button */}
                    <div className="flex-1 flex justify-start">
                        {showBackButton && (
                            <button
                                onClick={handleBack}
                                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/60 hover:bg-white text-unbox-grey hover:text-unbox-dark transition-all shadow-sm backdrop-blur-md border border-white/40"
                                aria-label="Go back"
                            >
                                <ArrowLeft size={18} />
                            </button>
                        )}
                    </div>

                    {/* Center: logo */}
                    <div className="flex-1 flex justify-center">
                        <Link to="/" className="flex items-center group" onClick={resetBooking}>
                            <img
                                src="/unbox-logo.png"
                                alt="Unbox"
                                className="h-[50px] sm:h-[81px] object-contain cursor-pointer group-hover:scale-[1.15] transition-transform duration-200 drop-shadow-sm"
                            />
                        </Link>
                    </div>

                    {/* Right: auth button */}
                    <div className="flex-1 flex justify-end">
                        {!currentUser ? (
                            <Link
                                to="/login"
                                className="flex items-center gap-2 px-4 py-2 rounded-full text-white text-sm font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all bg-[#476D6B]"
                            >
                                <LogIn size={15} />
                                Войти
                            </Link>
                        ) : (
                            <button
                                onClick={() => navigate('/dashboard')}
                                className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-white/80 backdrop-blur-md border border-white/50 text-unbox-dark hover:bg-white transition-all text-sm font-medium shadow-md hover:shadow-lg hover:-translate-y-0.5"
                            >
                                <div
                                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm bg-[#476D6B]"
                                >
                                    {currentUser.name?.charAt(0).toUpperCase() ?? <LayoutDashboard size={12} />}
                                </div>
                                <span className="max-w-[120px] truncate">{currentUser.name}</span>
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className={`flex-grow relative z-10 flex flex-col ${fullWidth ? 'w-full' : 'container mx-auto max-w-4xl'} ${noPadding ? '' : 'px-4 py-6'}`}>
                {children}
            </main>
        </div>
    );
}
