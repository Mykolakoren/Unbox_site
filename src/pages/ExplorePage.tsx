import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useBookingStore } from '../store/bookingStore';
import { useUserStore } from '../store/userStore';
import { useLocations } from '../hooks/useLocations';
import { JoinWaitlistModal } from '../components/JoinWaitlistModal';
import { TeamSection } from '../components/TeamSection';
import { SpecialistsSection } from '../components/SpecialistsSection';
import { WelcomeOverlay } from '../components/WelcomeOverlay';

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
import { GridHouseLanding } from '../components/landing/GridHouseLanding';
import { LogIn, LayoutDashboard, ChevronDown, ShieldCheck } from 'lucide-react';
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

// ─── Header style (post-Liquid Glass) ──────────────────────────────────────
const glassHeader: React.CSSProperties = {
    background: 'rgba(255,255,255,0.94)',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '0 1px 8px rgba(0,0,0,0.03)',
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

    const isAdmin = currentUser && ['admin', 'senior_admin', 'owner'].includes(currentUser.role ?? '');

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

    // ── Grid House design flag — full-page rollback-safe variant ──
    return (
        <>
            <GridHouseLanding
                visitorMode={visitorMode}
                onModeSelect={handleModeSelect}
                onModeReset={resetMode}
            />
            <MobileBookFab visitorMode={visitorMode} />
        </>
        );
}

// ── Mobile floating "+ Забронировать" button ────────────────────────────────
// Mobile users almost always come here to book a room quickly. The current
// landing has a long path: WelcomeGate → ClientLanding → scroll/find CTA.
// FAB short-circuits that — visible on every variant, fixed bottom-right,
// one tap → /checkout. Hidden on the welcome gate (no mode picked yet) and
// on desktop (≥768px) where the regular CTAs are easy to find.
function MobileBookFab({ visitorMode }: { visitorMode: 'client' | 'specialist' | null }) {
    const navigate = useNavigate();
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    if (!isMobile) return null;
    if (visitorMode === null) return null; // gate first — don't crowd the choice
    return (
        <button
            onClick={() => navigate('/checkout')}
            aria-label="Забронировать кабинет"
            style={{
                position: 'fixed',
                right: 16,
                bottom: 'calc(16px + env(safe-area-inset-bottom))',
                zIndex: 50,
                background: '#1f2a37',
                color: '#fff',
                padding: '14px 20px',
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 14,
                fontWeight: 700,
                boxShadow: '0 6px 20px rgba(31,42,55,0.35), 0 1px 3px rgba(0,0,0,0.2)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                letterSpacing: '0.01em',
            }}
        >
            <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>+</span>
            Забронировать
        </button>
    );
}

