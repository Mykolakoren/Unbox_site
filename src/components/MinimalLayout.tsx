import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useBookingStore } from '../store/bookingStore';

interface MinimalLayoutProps {
    children: React.ReactNode;
    showBackButton?: boolean;
    onBack?: () => void;
    fullWidth?: boolean;
    noPadding?: boolean;
}

export function MinimalLayout({ children, showBackButton = true, onBack, fullWidth = false, noPadding = false }: MinimalLayoutProps) {
    const navigate = useNavigate();
    const resetBooking = useBookingStore(s => s.reset);

    const handleBack = () => {
        if (onBack) {
            onBack();
        } else {
            navigate(-1);
        }
    };

    const handleLogoClick = () => {
        resetBooking();
    };

    return (
        <div className="min-h-screen bg-unbox-light text-unbox-dark font-sans selection:bg-unbox-green selection:text-white flex flex-col relative overflow-hidden">
            {/* Ambient Background decoration */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-unbox-green/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-blue-500/5 rounded-full blur-[100px] pointer-events-none" />

            {/* Header */}
            <header className="w-full relative z-10 pt-6 pb-2">
                <div className={`mx-auto ${fullWidth ? 'max-w-[1920px] w-full px-8' : 'container max-w-4xl px-4'} flex items-center justify-between`}>
                    <div className="flex-1 flex justify-start">
                        {showBackButton && (
                            <button 
                                onClick={handleBack}
                                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/50 hover:bg-white text-gray-600 hover:text-unbox-dark transition-all glass shadow-sm"
                                aria-label="Go back"
                            >
                                <ArrowLeft size={20} />
                            </button>
                        )}
                    </div>

                    <div className="flex-1 flex justify-center">
                        <Link
                            to="/"
                            className="flex items-center group"
                            onClick={handleLogoClick}
                        >
                            <img src="/unbox-logo.png" alt="Unbox" className="h-10 object-contain cursor-pointer group-hover:scale-105 premium-transition" />
                        </Link>
                    </div>

                    <div className="flex-1" /> {/* Spacer for centering */}
                </div>
            </header>

            {/* Main Content */}
            <main className={`flex-grow relative z-10 flex flex-col ${fullWidth ? 'w-full' : 'container mx-auto max-w-4xl'} ${noPadding ? '' : 'px-4 py-6'}`}>
                {children}
            </main>
        </div>
    );
}
