import { Link } from 'react-router-dom';
import { User, Video, MapPin, Tent, ArrowRight } from 'lucide-react';

export interface Specialist {
    id: string;
    firstName: string;
    lastName: string;
    photoUrl?: string;
    tagline: string;
    bio?: string;
    specializations: string[];
    formats: string[];
    basePriceGel: number;
}

interface SpecialistCardProps {
    specialist: Specialist;
}

const glassCard: React.CSSProperties = {
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(20px) saturate(140%)',
    WebkitBackdropFilter: 'blur(20px) saturate(140%)',
    border: '1px solid rgba(255,255,255,0.55)',
    boxShadow: '0 2px 12px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.02)',
};

export function SpecialistCard({ specialist }: SpecialistCardProps) {
    const hasOnline = specialist.formats.includes('ONLINE');
    const hasOfflineRoom = specialist.formats.includes('OFFLINE_ROOM');
    const hasOfflineCapsule = specialist.formats.includes('OFFLINE_CAPSULE');
    const hasOffline = hasOfflineRoom || hasOfflineCapsule;

    return (
        <Link
            to={`/specialists/${specialist.id}`}
            className="block h-full group"
        >
            <div
                className="h-full flex flex-col rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1"
                style={glassCard}
            >
                {/* Image */}
                <div className="relative aspect-[3/4] overflow-hidden bg-gradient-to-br from-unbox-light/60 to-white">
                    {specialist.photoUrl ? (
                        <img
                            src={specialist.photoUrl}
                            alt={`${specialist.firstName} ${specialist.lastName}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-unbox-grey/40 group-hover:scale-105 transition-transform duration-500">
                            <User size={56} strokeWidth={1} />
                        </div>
                    )}

                    {/* Gradient overlay bottom for text readability */}
                    <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/25 to-transparent pointer-events-none" />

                    {/* Price badge */}
                    <div
                        className="absolute top-3 right-3 px-3 py-1 rounded-xl text-xs font-bold text-unbox-dark"
                        style={{
                            background: 'rgba(255,255,255,0.88)',
                            backdropFilter: 'blur(12px)',
                            WebkitBackdropFilter: 'blur(12px)',
                            border: '1px solid rgba(255,255,255,0.50)',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                        }}
                    >
                        от {specialist.basePriceGel} ₾
                    </div>

                    {/* Format badges on photo */}
                    <div className="absolute bottom-3 left-3 flex gap-1.5">
                        {hasOnline && (
                            <span
                                className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-white"
                                style={{
                                    background: 'rgba(71,109,107,0.85)',
                                    backdropFilter: 'blur(8px)',
                                    WebkitBackdropFilter: 'blur(8px)',
                                }}
                            >
                                <Video size={10} />
                                Онлайн
                            </span>
                        )}
                        {hasOffline && (
                            <span
                                className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-white"
                                style={{
                                    background: 'rgba(44,50,64,0.75)',
                                    backdropFilter: 'blur(8px)',
                                    WebkitBackdropFilter: 'blur(8px)',
                                }}
                            >
                                {hasOfflineRoom ? <MapPin size={10} /> : <Tent size={10} />}
                                {hasOfflineRoom && hasOfflineCapsule ? 'Кабинет + Капсула' : hasOfflineRoom ? 'Кабинет' : 'Капсула'}
                            </span>
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="p-4 flex-1 flex flex-col">
                    <h3 className="text-base font-bold text-unbox-dark leading-tight mb-1">
                        {specialist.firstName} {specialist.lastName}
                    </h3>

                    <p className="text-xs text-unbox-dark/55 mb-3 line-clamp-2 leading-relaxed">
                        {specialist.tagline}
                    </p>

                    {/* Specialization tags */}
                    <div className="mb-4 flex-1">
                        <div className="flex flex-wrap gap-1">
                            {specialist.specializations.slice(0, 3).map((tag, idx) => (
                                <span
                                    key={idx}
                                    className="text-[10px] px-2 py-0.5 rounded-lg text-unbox-dark/60 font-medium"
                                    style={{
                                        background: 'rgba(212,226,225,0.45)',
                                        border: '1px solid rgba(212,226,225,0.60)',
                                    }}
                                >
                                    {tag}
                                </span>
                            ))}
                            {specialist.specializations.length > 3 && (
                                <span
                                    className="text-[10px] px-2 py-0.5 rounded-lg text-unbox-grey/70 font-medium"
                                    style={{
                                        background: 'rgba(212,226,225,0.30)',
                                        border: '1px solid rgba(212,226,225,0.45)',
                                    }}
                                >
                                    +{specialist.specializations.length - 3}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* CTA */}
                    <div className="flex items-center justify-between pt-3 border-t border-unbox-light/40">
                        <span className="text-xs font-semibold text-unbox-green group-hover:text-unbox-dark transition-colors duration-200">
                            Подробнее
                        </span>
                        <span className="w-7 h-7 rounded-full flex items-center justify-center bg-unbox-light/50 group-hover:bg-unbox-dark text-unbox-green group-hover:text-white transition-all duration-200">
                            <ArrowRight size={14} />
                        </span>
                    </div>
                </div>
            </div>
        </Link>
    );
}
