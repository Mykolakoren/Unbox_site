import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useBookingStore } from '../store/bookingStore';
import { useUserStore } from '../store/userStore';
import { useLocations } from '../hooks/useLocations';
import { JoinWaitlistModal } from '../components/JoinWaitlistModal';
import { TeamSection } from '../components/TeamSection';
import { SpecialistsSection } from '../components/SpecialistsSection';
import { WelcomeOverlay } from '../components/WelcomeOverlay';
import { HowItWorksSection } from '../components/landing/HowItWorksSection';
import { EventsSection } from '../components/landing/EventsSection';
import { ArticlesSection } from '../components/landing/ArticlesSection';
import { ReferralSection } from '../components/landing/ReferralSection';
import { WhyUnboxSection } from '../components/landing/WhyUnboxSection';
import { CabinetsShowcaseSection } from '../components/landing/CabinetsShowcaseSection';
import { SpecialistApplySection } from '../components/landing/SpecialistApplySection';
import { SpecialistOnboardingHero } from '../components/landing/SpecialistOnboardingHero';
import { SpecialistPortalHero } from '../components/landing/SpecialistPortalHero';
import { ContactSection } from '../components/landing/ContactSection';
import { ClientHeroPanel } from '../components/landing/ClientHeroPanel';
import { SelfTestsSection } from '../components/landing/SelfTestsSection';
import { LogIn, LayoutDashboard, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

function MapBounds({ locations, selectedLocId }: { locations: any[], selectedLocId: string | null }) {
    const map = useMap();
    useEffect(() => {
        if (selectedLocId) {
            const loc = locations.find((l: any) => l.id === selectedLocId);
            if (loc && loc.lat && loc.lng) map.flyTo([loc.lat, loc.lng], 15, { duration: 1.5 });
        } else {
            const validLocs = locations.filter((l: any) => l.lat && l.lng);
            if (validLocs.length > 0) {
                const bounds = L.latLngBounds(validLocs.map((l: any) => [l.lat, l.lng]));
                map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
            }
        }
    }, [locations, selectedLocId, map]);
    return null;
}

// ─── iOS 26 Liquid Glass styles ────────────────────────────────────────────
const glassHeader: React.CSSProperties = {
    background: 'rgba(255,255,255,0.10)',
    backdropFilter: 'blur(24px) saturate(150%)',
    WebkitBackdropFilter: 'blur(24px) saturate(150%)',
    border: '1px solid rgba(255,255,255,0.22)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.40)',
};

const glassMapFrame: React.CSSProperties = {
    background: 'rgba(255,255,255,0.10)',
    backdropFilter: 'blur(20px) saturate(140%)',
    WebkitBackdropFilter: 'blur(20px) saturate(140%)',
    border: '1.5px solid rgba(255,255,255,0.28)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.40)',
};
// ────────────────────────────────────────────────────────────────────────────

type VisitorMode = 'client' | 'specialist' | null;

export function ExplorePage() {
    const { reset: resetBooking } = useBookingStore();
    const { currentUser } = useUserStore();
    const { data: locations = [], isLoading } = useLocations();
    const navigate = useNavigate();

    // ── Visitor mode ──────────────────────────────────────────────
    const [visitorMode, setVisitorMode] = useState<VisitorMode>(() => {
        return localStorage.getItem('unbox_visitor_mode') as VisitorMode;
    });

    const handleModeSelect = (mode: 'client' | 'specialist') => {
        localStorage.setItem('unbox_visitor_mode', mode);
        setVisitorMode(mode);
    };

    const resetMode = () => {
        localStorage.removeItem('unbox_visitor_mode');
        setVisitorMode(null);
    };

    // ── Category filter (client mode) ─────────────────────────────
    const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
    const specialistsSectionRef = useRef<HTMLDivElement>(null);

    const handleCategorySelect = (cat: string | null) => {
        setCategoryFilter(cat);
        setTimeout(() => {
            specialistsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
    };

    // ── Booking state ─────────────────────────────────────────────
    const [selectedLocId, setSelectedLocId] = useState<string | null>(null);
    const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);

    return (
        <div className="min-h-screen font-sans text-unbox-dark selection:bg-unbox-green selection:text-white overflow-x-hidden">

            {/* ══════════════════════════════════════════════
                WELCOME OVERLAY
            ══════════════════════════════════════════════ */}
            <AnimatePresence>
                {visitorMode === null && (
                    <WelcomeOverlay onSelect={handleModeSelect} />
                )}
            </AnimatePresence>

            {/* ══════════════════════════════════════════════
                FULL-PAGE BACKGROUND PHOTO
            ══════════════════════════════════════════════ */}
            <div className="fixed inset-0 z-0">
                <img
                    src="/hero-bg.jpg"
                    alt=""
                    className="w-full h-full object-cover object-[center_45%]"
                />
                <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.52)' }} />
            </div>

            {/* ══════════════════════════════════════════════
                GLASS HEADER — floating pill
            ══════════════════════════════════════════════ */}
            <header className="fixed top-0 left-0 right-0 z-50 px-4 md:px-8 pt-4">
                <div
                    className="flex items-center justify-between px-5 py-3 rounded-[22px] max-w-[1920px] mx-auto"
                    style={glassHeader}
                >
                    {/* Left: mode switcher */}
                    <div className="flex-1 flex items-center">
                        {visitorMode && (
                            <button
                                onClick={resetMode}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-unbox-dark/70 hover:text-unbox-dark transition-colors"
                                style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.70)' }}
                            >
                                {visitorMode === 'client' ? 'Клиент' : 'Специалист'}
                                <ChevronDown size={12} />
                            </button>
                        )}
                    </div>

                    {/* Center: Logo */}
                    <Link to="/" onClick={resetBooking} className="flex items-center group">
                        <img
                            src="/unbox-logo.png"
                            alt="Unbox"
                            className="h-[81px] object-contain drop-shadow-md group-hover:scale-[1.15] transition-transform duration-200"
                        />
                    </Link>

                    {/* Right: Auth */}
                    <div className="flex-1 flex justify-end">
                        {!currentUser ? (
                            <Link
                                to="/login"
                                className="flex items-center gap-2 px-4 py-2 rounded-full text-white text-sm font-semibold shadow-lg hover:-translate-y-0.5 transition-all brand-gradient"
                            >
                                <LogIn size={15} />
                                Войти
                            </Link>
                        ) : (
                            <button
                                onClick={() => navigate('/dashboard')}
                                className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-md border border-white/60 text-unbox-dark hover:bg-white transition-all text-sm font-medium shadow-md"
                            >
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 brand-gradient">
                                    {currentUser.name?.charAt(0).toUpperCase() ?? <LayoutDashboard size={12} />}
                                </div>
                                <span className="max-w-[120px] truncate">{currentUser.name}</span>
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* ══════════════════════════════════════════════
                MAIN HERO CONTENT
            ══════════════════════════════════════════════ */}
            <AnimatePresence mode="wait">
                {visitorMode === 'client' && (
                    <motion.main
                        key="client-main"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, delay: 0.1 }}
                        className="relative z-10 pt-[132px] pb-10 px-6 md:px-12 flex flex-col lg:flex-row gap-8 items-stretch"
                    >
                        <>
                            {/* ── LEFT: ClientHeroPanel ── */}
                            <div className="w-full lg:w-[44%] shrink-0 flex items-center">
                                <div className="w-full">
                                    <ClientHeroPanel
                                        activeCategory={categoryFilter}
                                        onCategorySelect={handleCategorySelect}
                                    />
                                </div>
                            </div>

                            {/* ── RIGHT MAP PANEL ── */}
                            <div
                                className="hidden lg:flex flex-1 rounded-[28px] overflow-hidden relative"
                                style={{ ...glassMapFrame, maxHeight: 'calc(100vh - 172px)' }}
                            >
                                {isLoading ? (
                                    <div className="flex-1 flex items-center justify-center">
                                        <div className="w-10 h-10 border-4 border-white/40 border-t-white rounded-full animate-spin" />
                                    </div>
                                ) : (
                                    <MapContainer
                                        center={[41.6416, 41.6415]}
                                        zoom={12}
                                        style={{ height: '100%', width: '100%' }}
                                        zoomControl={false}
                                    >
                                        <MapBounds locations={locations} selectedLocId={selectedLocId} />
                                        <TileLayer
                                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                                            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                                        />
                                        {locations.filter(l => l.lat && l.lng).map(loc => (
                                            <Marker
                                                key={loc.id}
                                                position={[loc.lat!, loc.lng!]}
                                                eventHandlers={{ click: () => setSelectedLocId(loc.id) }}
                                            >
                                                <Popup className="premium-popup">
                                                    <div className="font-bold text-unbox-dark text-sm">{loc.name}</div>
                                                    <div className="text-unbox-grey text-xs mt-0.5">{loc.address}</div>
                                                </Popup>
                                            </Marker>
                                        ))}
                                    </MapContainer>
                                )}
                            </div>
                        </>
                    </motion.main>
                )}

                {visitorMode === 'specialist' && (
                    <motion.main
                        key="specialist-main"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, delay: 0.1 }}
                        className="relative z-10 pt-[132px] pb-10 px-6 md:px-12 flex flex-col lg:flex-row gap-8 items-stretch"
                    >
                        {currentUser?.role === 'specialist' ? (
                            /* ── Logged-in specialist: full-width portal with bookings ── */
                            <div className="w-full max-w-4xl mx-auto">
                                <SpecialistPortalHero user={currentUser} />
                            </div>
                        ) : (
                            <>
                                {/* ── LEFT: Onboarding for guests ── */}
                                <div className="w-full lg:w-[58%] shrink-0 flex items-start">
                                    <SpecialistOnboardingHero
                                        onApply={() => document.getElementById('apply')?.scrollIntoView({ behavior: 'smooth' })}
                                    />
                                </div>

                                {/* ── RIGHT: Cabinet photo ── */}
                                <div
                                    className="hidden lg:block flex-1 rounded-[28px] overflow-hidden"
                                    style={{ maxHeight: 'calc(100vh - 172px)' }}
                                >
                                    <img
                                        src="/cabinet-bg.jpg"
                                        alt="Кабинет Unbox"
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                            </>
                        )}
                    </motion.main>
                )}
            </AnimatePresence>

            <JoinWaitlistModal isOpen={isWaitlistOpen} onClose={() => setIsWaitlistOpen(false)} />

            {/* ══════════════════════════════════════════════
                BELOW-FOLD SECTIONS (glass over mountain bg)
            ══════════════════════════════════════════════ */}
            {visitorMode && (
                <div className="relative z-10">
                    {visitorMode === 'client' ? (
                        <>
                            <div ref={specialistsSectionRef}>
                                <SpecialistsSection categoryFilter={categoryFilter} />
                            </div>
                            <SelfTestsSection onScrollToSpecialists={() => specialistsSectionRef.current?.scrollIntoView({ behavior: 'smooth' })} />
                            <HowItWorksSection />
                            <EventsSection />
                            <ArticlesSection />
                            <ReferralSection />
                            <TeamSection />
                            <ContactSection />
                        </>
                    ) : currentUser?.role === 'specialist' ? (
                        // Logged-in specialist: no onboarding sections, no apply form
                        <>
                            <CabinetsShowcaseSection />
                            <SpecialistsSection />
                            <TeamSection />
                            <ContactSection />
                        </>
                    ) : (
                        // Guest / non-specialist: full onboarding funnel
                        <>
                            <WhyUnboxSection />
                            <CabinetsShowcaseSection />
                            <SpecialistsSection />
                            <SpecialistApplySection />
                            <TeamSection />
                            <ContactSection />
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
