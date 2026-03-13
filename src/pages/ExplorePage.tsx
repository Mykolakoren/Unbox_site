import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useBookingStore } from '../store/bookingStore';
import { useUserStore } from '../store/userStore';
import { useLocations } from '../hooks/useLocations';
import { JoinWaitlistModal } from '../components/JoinWaitlistModal';
import { MapPin, ArrowRight, User, Users, Filter, LogIn, LayoutDashboard } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import clsx from 'clsx';
import type { Format, GroupSize } from '../types';

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

const GROUP_SIZES: { value: GroupSize; label: string }[] = [
    { value: '4-8', label: '4-8 человек' },
    { value: '8-14', label: '8-14 человек' },
    { value: '14-20', label: '14-20 человек' },
    { value: '20-30', label: '20-30 человек' },
    { value: '30+', label: '30+ человек' },
];

// ─── iOS 26 Liquid Glass styles ────────────────────────────────────────────
const glassPanel: React.CSSProperties = {
    background: 'rgba(255,255,255,0.14)',
    backdropFilter: 'blur(36px) saturate(160%)',
    WebkitBackdropFilter: 'blur(36px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.28)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.45)',
};

const glassHeader: React.CSSProperties = {
    background: 'rgba(255,255,255,0.10)',
    backdropFilter: 'blur(24px) saturate(150%)',
    WebkitBackdropFilter: 'blur(24px) saturate(150%)',
    border: '1px solid rgba(255,255,255,0.22)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.40)',
};

const glassCard: React.CSSProperties = {
    background: 'rgba(255,255,255,0.22)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255,255,255,0.35)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
};

const glassMapFrame: React.CSSProperties = {
    background: 'rgba(255,255,255,0.10)',
    backdropFilter: 'blur(20px) saturate(140%)',
    WebkitBackdropFilter: 'blur(20px) saturate(140%)',
    border: '1.5px solid rgba(255,255,255,0.28)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.40)',
};
// ────────────────────────────────────────────────────────────────────────────

export function ExplorePage() {
    const { setLocation, setFormat, setGroupSize, setStep, reset: resetBooking } = useBookingStore();
    const { currentUser } = useUserStore();
    const { data: locations = [], isLoading } = useLocations();
    const navigate = useNavigate();

    const [selectedLocId, setSelectedLocId] = useState<string | null>(null);
    const [selectedFormat, setSelectedFormat] = useState<Format | null>(null);
    const [selectedSize, setSelectedSize] = useState<GroupSize | null>(null);
    const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);

    const canProceed = selectedLocId && selectedFormat && (selectedFormat === 'individual' || selectedSize);

    const handleProceed = () => {
        if (!canProceed) return;
        setLocation(selectedLocId);
        setFormat(selectedFormat);
        setGroupSize(selectedFormat === 'group' ? selectedSize : null);
        setStep(2);
        navigate('/checkout');
    };

    return (
        <div className="min-h-screen font-sans text-unbox-dark selection:bg-unbox-green selection:text-white overflow-hidden">

            {/* ══════════════════════════════════════════════
                FULL-PAGE BACKGROUND PHOTO
            ══════════════════════════════════════════════ */}
            <div className="fixed inset-0 z-0">
                <img
                    src="/hero-bg.jpg"
                    alt=""
                    className="w-full h-full object-cover object-[center_45%]"
                />
                {/* Light white wash — photo stays visible but softened */}
                <div
                    className="absolute inset-0"
                    style={{ background: 'rgba(255,255,255,0.52)' }}
                />
            </div>

            {/* ══════════════════════════════════════════════
                GLASS HEADER — floating pill
            ══════════════════════════════════════════════ */}
            <header className="fixed top-0 left-0 right-0 z-50 px-4 md:px-8 pt-4">
                <div
                    className="flex items-center justify-between px-5 py-3 rounded-[22px] max-w-[1920px] mx-auto"
                    style={glassHeader}
                >
                    {/* Left spacer */}
                    <div className="flex-1" />

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
                                <div
                                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 brand-gradient"
                                >
                                    {currentUser.name?.charAt(0).toUpperCase() ?? <LayoutDashboard size={12} />}
                                </div>
                                <span className="max-w-[120px] truncate">{currentUser.name}</span>
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* ══════════════════════════════════════════════
                MAIN CONTENT
            ══════════════════════════════════════════════ */}
            <main className="relative z-10 min-h-screen pt-[132px] pb-10 px-6 md:px-12 flex flex-col lg:flex-row gap-8 items-start">

                {isLoading ? (
                    <div className="flex-1 flex items-center justify-center min-h-[70vh]">
                        <div className="w-12 h-12 border-4 border-white/40 border-t-white rounded-full animate-spin drop-shadow" />
                    </div>
                ) : (
                    <>
                        {/* ── LEFT GLASS PANEL ────────────────────────── */}
                        <div
                            className="w-full lg:w-[56%] shrink-0 rounded-[28px] overflow-hidden flex flex-col"
                            style={{ ...glassPanel, maxHeight: 'calc(100vh - 172px)' }}
                        >
                            {/* Panel title bar */}
                            <div
                                className="px-8 pt-7 pb-6 shrink-0"
                                style={{ borderBottom: '1px solid rgba(255,255,255,0.45)' }}
                            >
                                <h1 className="text-xl font-black text-unbox-dark tracking-tight">
                                    Найди своё пространство
                                </h1>
                                <p className="text-unbox-grey text-sm mt-0.5 font-medium">
                                    Кабинеты для работы в Батуми
                                </p>
                            </div>

                            {/* Scrollable content */}
                            <div className="overflow-y-auto flex-1 px-8 py-8 space-y-10">

                                {/* ── Формат ── */}
                                <section>
                                    <h2 className="text-xs font-bold text-unbox-grey uppercase tracking-wider mb-5 flex items-center gap-2">
                                        <Users className="w-4 h-4 text-unbox-green" />
                                        1. Выберите формат
                                    </h2>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {[
                                            { id: 'individual' as Format, label: 'Индивидуально', sub: 'Для одного человека', icon: User },
                                            { id: 'group' as Format, label: 'Группа', sub: 'Для команд и мероприятий', icon: Users },
                                        ].map(({ id, label, sub, icon: Icon }) => (
                                            <button
                                                key={id}
                                                onClick={() => { setSelectedFormat(id); if (id === 'individual') setSelectedSize(null); }}
                                                className={clsx(
                                                    "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all duration-200 text-left w-full",
                                                    selectedFormat === id
                                                        ? "border-unbox-green shadow-lg shadow-unbox-green/20 scale-[1.02]"
                                                        : "border-white/60 hover:border-unbox-green/40 hover:shadow-md"
                                                )}
                                                style={selectedFormat === id
                                                    ? { background: 'rgba(71,109,107,0.12)' }
                                                    : glassCard
                                                }
                                            >
                                                <div className={clsx("p-3 rounded-full shrink-0 transition-colors", selectedFormat === id ? "bg-unbox-green text-white shadow-md shadow-unbox-green/30" : "bg-white/80 text-unbox-grey")}>
                                                    <Icon className="w-6 h-6" />
                                                </div>
                                                <div>
                                                    <div className={clsx("font-bold text-base leading-tight", selectedFormat === id ? "text-unbox-dark" : "text-unbox-dark")}>{label}</div>
                                                    <div className="text-unbox-grey text-xs mt-0.5">{sub}</div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </section>

                                {/* ── Размер группы ── */}
                                <AnimatePresence>
                                    {selectedFormat === 'group' && (
                                        <motion.section
                                            initial={{ opacity: 0, height: 0, y: -10 }}
                                            animate={{ opacity: 1, height: 'auto', y: 0 }}
                                            exit={{ opacity: 0, height: 0, y: -10 }}
                                            className="overflow-hidden"
                                        >
                                            <h2 className="text-xs font-bold text-unbox-grey uppercase tracking-wider mb-5">Количество человек</h2>
                                            <div className="flex flex-wrap gap-2">
                                                {GROUP_SIZES.map(size => (
                                                    <button
                                                        key={size.value}
                                                        onClick={() => setSelectedSize(size.value)}
                                                        className={clsx(
                                                            "px-4 py-2 rounded-full border-2 text-sm font-medium transition-all hover:scale-105 active:scale-95",
                                                            selectedSize === size.value
                                                                ? "border-unbox-green bg-unbox-green text-white shadow-md shadow-unbox-green/30"
                                                                : "border-white/70 bg-white/60 text-unbox-dark hover:border-unbox-green/50"
                                                        )}
                                                    >
                                                        {size.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </motion.section>
                                    )}
                                </AnimatePresence>

                                {/* ── Локации ── */}
                                <AnimatePresence>
                                    {selectedFormat && (selectedFormat === 'individual' || selectedSize) && (
                                        <motion.section
                                            initial={{ opacity: 0, scale: 0.97 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{ delay: 0.05 }}
                                        >
                                            <div
                                                className="h-px w-full mb-6"
                                                style={{ background: 'rgba(255,255,255,0.45)' }}
                                            />
                                            <div className="flex items-center justify-between mb-5">
                                                <h2 className="text-xs font-bold text-unbox-grey uppercase tracking-wider flex items-center gap-2">
                                                    <MapPin className="w-4 h-4 text-unbox-green" />
                                                    2. Выберите локацию
                                                </h2>
                                                <span className="text-xs font-medium bg-white/60 text-unbox-grey px-3 py-1 rounded-full border border-white/70">
                                                    Найдено: {locations.length}
                                                </span>
                                            </div>

                                            <div className="flex flex-col gap-5">
                                                {locations.map((loc, index) => {
                                                    const isSelected = selectedLocId === loc.id;
                                                    return (
                                                        <motion.div
                                                            key={loc.id}
                                                            initial={{ opacity: 0, y: 16 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            transition={{ duration: 0.3, delay: index * 0.08 }}
                                                            className="flex items-stretch gap-3"
                                                        >
                                                            <button
                                                                onClick={() => setSelectedLocId(loc.id)}
                                                                className={clsx(
                                                                    "flex-1 flex flex-col sm:flex-row text-left rounded-2xl border-2 overflow-hidden transition-all duration-250 group",
                                                                    isSelected
                                                                        ? "border-unbox-green shadow-xl shadow-unbox-green/15 scale-[1.01]"
                                                                        : "hover:border-unbox-green/40 hover:shadow-lg hover:scale-[1.005]"
                                                                )}
                                                                style={isSelected
                                                                    ? { ...glassCard, background: 'rgba(71,109,107,0.10)', border: '2px solid rgba(71,109,107,0.60)' }
                                                                    : glassCard
                                                                }
                                                            >
                                                                {/* Photo */}
                                                                <div className="h-32 sm:h-auto sm:w-40 bg-unbox-light/50 relative overflow-hidden shrink-0">
                                                                    {loc.image ? (
                                                                        <img src={loc.image} alt={loc.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                                                    ) : (
                                                                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-unbox-light to-white">
                                                                            <span className="text-unbox-grey text-xs font-medium">Нет фото</span>
                                                                        </div>
                                                                    )}
                                                                    <div className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-unbox-green shadow-sm">
                                                                        Partner
                                                                    </div>
                                                                </div>
                                                                {/* Info */}
                                                                <div className="p-4 flex-1">
                                                                    <div className="font-bold text-base text-unbox-dark leading-tight mb-1">{loc.name}</div>
                                                                    <div className="flex items-center text-unbox-grey text-xs mb-3">
                                                                        <MapPin className="w-3.5 h-3.5 mr-1 shrink-0 text-unbox-grey" />
                                                                        {loc.address}
                                                                    </div>
                                                                    {loc.features && loc.features.length > 0 && (
                                                                        <div className="flex flex-wrap gap-1.5">
                                                                            {loc.features.slice(0, 3).map((f: string, i: number) => (
                                                                                <span key={i} className="text-[10px] bg-white/80 text-unbox-grey px-2 py-0.5 rounded-md border border-white/90 font-medium">{f}</span>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </button>

                                                            {/* Arrow button */}
                                                            <AnimatePresence>
                                                                {isSelected && (
                                                                    <motion.button
                                                                        initial={{ opacity: 0, x: -16, scale: 0.85 }}
                                                                        animate={{ opacity: 1, x: 0, scale: 1 }}
                                                                        exit={{ opacity: 0, x: -8, scale: 0.9 }}
                                                                        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                                                                        onClick={handleProceed}
                                                                        className="shrink-0 w-14 rounded-2xl bg-unbox-green hover:bg-unbox-dark text-white flex flex-col items-center justify-center gap-1.5 shadow-lg shadow-unbox-green/30 hover:-translate-y-0.5 transition-all active:scale-95"
                                                                    >
                                                                        <ArrowRight className="w-5 h-5" />
                                                                        <span className="text-[9px] font-bold">Далее</span>
                                                                    </motion.button>
                                                                )}
                                                            </AnimatePresence>
                                                        </motion.div>
                                                    );
                                                })}
                                            </div>
                                        </motion.section>
                                    )}
                                </AnimatePresence>

                                {/* ── Продолжить / Лист ожидания ── */}
                                <div className="pb-2">
                                    <AnimatePresence mode="wait">
                                        {canProceed ? (
                                            <motion.div
                                                key="proceed"
                                                initial={{ opacity: 0, y: 12 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: 8 }}
                                            >
                                                <button
                                                    onClick={handleProceed}
                                                    className="flex items-center justify-center gap-3 w-full py-4 rounded-2xl font-bold text-base bg-unbox-green hover:bg-unbox-dark text-white shadow-xl shadow-unbox-green/30 hover:-translate-y-0.5 transition-all active:scale-95"
                                                >
                                                    Смотреть расписание
                                                    <ArrowRight className="w-5 h-5" />
                                                </button>
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                key="waitlist"
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                transition={{ delay: 0.4 }}
                                                className="text-center pt-4"
                                                style={{ borderTop: '1px solid rgba(255,255,255,0.40)' }}
                                            >
                                                <p className="text-unbox-grey text-sm mb-2">Не нашли подходящий вариант?</p>
                                                <button
                                                    onClick={() => setIsWaitlistOpen(true)}
                                                    className="text-unbox-green font-bold hover:text-unbox-dark underline underline-offset-4 decoration-unbox-green/30 transition-colors text-sm"
                                                >
                                                    Присоединиться к листу ожидания
                                                </button>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                            </div>{/* /scrollable */}
                        </div>{/* /left panel */}

                        {/* ── RIGHT GLASS MAP PANEL ──────────────────── */}
                        <div
                            className="hidden lg:block flex-1 rounded-[28px] overflow-hidden relative"
                            style={{ ...glassMapFrame, height: 'calc(100vh - 172px)' }}
                        >
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
                                            {selectedLocId !== loc.id && (
                                                <button
                                                    onClick={() => setSelectedLocId(loc.id)}
                                                    className="mt-2 w-full bg-unbox-green hover:bg-unbox-dark text-white py-1.5 rounded text-xs font-bold transition-colors"
                                                >
                                                    Выбрать
                                                </button>
                                            )}
                                        </Popup>
                                    </Marker>
                                ))}
                            </MapContainer>

                            {/* Glass filter badge */}
                            <div className="absolute top-4 right-4 z-[400]">
                                <button
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-unbox-dark hover:bg-white/80 transition-colors"
                                    style={glassCard}
                                >
                                    <Filter className="w-4 h-4" />
                                    Фильтры
                                </button>
                            </div>
                        </div>{/* /map panel */}
                    </>
                )}
            </main>

            <JoinWaitlistModal isOpen={isWaitlistOpen} onClose={() => setIsWaitlistOpen(false)} />
        </div>
    );
}
