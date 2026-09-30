import { ArrowLeft, LogIn, LayoutDashboard } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useBookingStore } from '../store/bookingStore';
import { useUserStore } from '../store/userStore';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { COLOR } from '../design/tokens';

interface MinimalLayoutProps {
    children: React.ReactNode;
    showBackButton?: boolean;
    onBack?: () => void;
    fullWidth?: boolean;
    noPadding?: boolean;
    glassMode?: boolean;
    /** Подпись у стрелки «назад» (мастер брони: «К выбору времени»). */
    backLabel?: string;
}

export function MinimalLayout({
    children,
    showBackButton = true,
    onBack,
    fullWidth = false,
    noPadding = false,
    glassMode = false,
    backLabel = 'Назад',
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
                        padding: '10px 24px',
                        minHeight: 64,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}>
                        {/* Left: back + logo */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            {/* «Назад» с подписью — одна на экран (G3-11): раньше рядом
                                жили ещё «← Назад» у кнопки оплаты и серое «Назад» в корзине. */}
                            {showBackButton && (
                                <button
                                    type="button"
                                    onClick={handleBack}
                                    style={{
                                        minHeight: 44, padding: '0 14px 0 10px',
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        border: `1px solid ${GH.ink10}`,
                                        borderRadius: 8,
                                        background: 'transparent',
                                        color: GH.ink,
                                        fontFamily: GH_SANS, fontSize: 14, fontWeight: 500,
                                        cursor: 'pointer',
                                    }}
                                >
                                    <ArrowLeft size={16} aria-hidden="true" />
                                    {backLabel}
                                </button>
                            )}
                            <Link
                                to="/"
                                onClick={resetBooking}
                                style={{
                                    fontFamily: GH_MONO,
                                    fontSize: 16,
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
                                        minHeight: 44,
                                        padding: '0 18px',
                                        background: GH.accent,
                                        color: COLOR.onAccent,
                                        borderRadius: 8,
                                        fontSize: 14,
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
                                    type="button"
                                    onClick={() => navigate('/dashboard')}
                                    aria-label={`Мой кабинет — ${currentUser.name ?? ''}`}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        minHeight: 44,
                                        padding: '0 14px',
                                        background: GH.ink5,
                                        border: `1px solid ${GH.ink8}`,
                                        borderRadius: 8,
                                        cursor: 'pointer',
                                        fontFamily: GH_SANS,
                                        fontSize: 14,
                                        fontWeight: 500,
                                        color: GH.ink,
                                    }}
                                >
                                    <div style={{
                                        width: 28, height: 28,
                                        borderRadius: '50%',
                                        background: GH.accent,
                                        color: COLOR.onAccent,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 12, fontWeight: 600,
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

    // ── DEFAULT MODE ────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-paper text-ink font-sans selection:bg-accent selection:text-on-accent flex flex-col relative overflow-hidden">

            {/* Header */}
            <header className="w-full relative z-10 pt-5 pb-2">
                <div className={`mx-auto ${fullWidth ? 'max-w-[1920px] w-full px-8' : 'container max-w-4xl px-4'} flex items-center justify-between`}>
                    {/* Left: back button */}
                    <div className="flex-1 flex justify-start">
                        {showBackButton && (
                            <button
                                onClick={handleBack}
                                className="w-11 h-11 flex items-center justify-center rounded-full bg-card hover:bg-ink-05 text-ink-60 hover:text-ink transition-colors border border-ink-10"
                                aria-label="Назад"
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
                                className="flex items-center gap-2 px-4 py-2 rounded-full text-on-accent text-sm font-semibold transition-colors bg-accent hover:bg-accent-hover"
                            >
                                <LogIn size={15} />
                                Войти
                            </Link>
                        ) : (
                            <button
                                onClick={() => navigate('/dashboard')}
                                className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-card border border-ink-10 text-ink hover:bg-ink-05 transition-colors text-sm font-medium"
                            >
                                <div
                                    className="w-7 h-7 rounded-full flex items-center justify-center text-on-accent text-xs font-semibold shrink-0 bg-accent"
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
