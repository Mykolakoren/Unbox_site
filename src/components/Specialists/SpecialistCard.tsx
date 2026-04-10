import { Link } from 'react-router-dom';
import { User, Video, MapPin, Tent, ArrowRight } from 'lucide-react';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

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

export function SpecialistCard({ specialist }: SpecialistCardProps) {
    const gridHouse = useDesignFlag();
    const hasOnline = specialist.formats.includes('ONLINE');
    const hasOfflineRoom = specialist.formats.includes('OFFLINE_ROOM');
    const hasOfflineCapsule = specialist.formats.includes('OFFLINE_CAPSULE');
    const hasOffline = hasOfflineRoom || hasOfflineCapsule;

    if (gridHouse) return <GHCard specialist={specialist} hasOnline={hasOnline} hasOffline={hasOffline} hasOfflineRoom={hasOfflineRoom} hasOfflineCapsule={hasOfflineCapsule} />;

    return (
        <Link to={`/specialists/${specialist.id}`} className="block h-full group">
            <div
                className="h-full flex flex-col rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1"
                style={{
                    background: 'rgba(255,255,255,0.72)',
                    backdropFilter: 'blur(20px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(140%)',
                    border: '1px solid rgba(255,255,255,0.55)',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.02)',
                }}
            >
                <div className="relative aspect-[3/4] overflow-hidden bg-gradient-to-br from-unbox-light/60 to-white">
                    {specialist.photoUrl ? (
                        <img src={specialist.photoUrl} alt={`${specialist.firstName} ${specialist.lastName}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-unbox-grey/40 group-hover:scale-105 transition-transform duration-500">
                            <User size={56} strokeWidth={1} />
                        </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/25 to-transparent pointer-events-none" />
                    <div className="absolute top-3 right-3 px-3 py-1 rounded-xl text-xs font-bold text-unbox-dark" style={{ background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.50)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                        от {specialist.basePriceGel} ₾
                    </div>
                    <div className="absolute bottom-3 left-3 flex gap-1.5">
                        {hasOnline && (
                            <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-white" style={{ background: 'rgba(71,109,107,0.85)', backdropFilter: 'blur(8px)' }}>
                                <Video size={10} /> Онлайн
                            </span>
                        )}
                        {hasOffline && (
                            <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-white" style={{ background: 'rgba(44,50,64,0.75)', backdropFilter: 'blur(8px)' }}>
                                {hasOfflineRoom ? <MapPin size={10} /> : <Tent size={10} />}
                                {hasOfflineRoom && hasOfflineCapsule ? 'Кабинет + Капсула' : hasOfflineRoom ? 'Кабинет' : 'Капсула'}
                            </span>
                        )}
                    </div>
                </div>
                <div className="p-4 flex-1 flex flex-col">
                    <h3 className="text-base font-bold text-unbox-dark leading-tight mb-1">
                        {specialist.firstName} {specialist.lastName}
                    </h3>
                    <p className="text-xs text-unbox-dark/55 mb-3 line-clamp-2 leading-relaxed">{specialist.tagline}</p>
                    <div className="mb-4 flex-1">
                        <div className="flex flex-wrap gap-1">
                            {specialist.specializations.slice(0, 3).map((tag, idx) => (
                                <span key={idx} className="text-[10px] px-2 py-0.5 rounded-lg text-unbox-dark/60 font-medium" style={{ background: 'rgba(212,226,225,0.45)', border: '1px solid rgba(212,226,225,0.60)' }}>
                                    {tag}
                                </span>
                            ))}
                            {specialist.specializations.length > 3 && (
                                <span className="text-[10px] px-2 py-0.5 rounded-lg text-unbox-grey/70 font-medium" style={{ background: 'rgba(212,226,225,0.30)', border: '1px solid rgba(212,226,225,0.45)' }}>
                                    +{specialist.specializations.length - 3}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-unbox-light/40">
                        <span className="text-xs font-semibold text-unbox-green group-hover:text-unbox-dark transition-colors duration-200">Подробнее</span>
                        <span className="w-7 h-7 rounded-full flex items-center justify-center bg-unbox-light/50 group-hover:bg-unbox-dark text-unbox-green group-hover:text-white transition-all duration-200">
                            <ArrowRight size={14} />
                        </span>
                    </div>
                </div>
            </div>
        </Link>
    );
}

/* ═══ Grid House Card ═══ */

function GHCard({ specialist, hasOnline, hasOffline, hasOfflineRoom, hasOfflineCapsule }: {
    specialist: Specialist; hasOnline: boolean; hasOffline: boolean; hasOfflineRoom: boolean; hasOfflineCapsule: boolean;
}) {
    return (
        <Link to={`/specialists/${specialist.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>
            <div style={{
                height: '100%', display: 'flex', flexDirection: 'column',
                border: `1px solid ${GH.ink10}`, background: GH.paper,
                transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = GH.ink; e.currentTarget.style.boxShadow = `4px 4px 0 ${GH.ink10}`; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = GH.ink10; e.currentTarget.style.boxShadow = 'none'; }}
            >
                {/* Photo */}
                <div style={{ position: 'relative', aspectRatio: '3/4', overflow: 'hidden', background: GH.ink5 }}>
                    {specialist.photoUrl ? (
                        <img src={specialist.photoUrl} alt={`${specialist.firstName} ${specialist.lastName}`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: GH.ink10 }}>
                            <User size={48} strokeWidth={1} />
                        </div>
                    )}
                    {/* Price */}
                    <div style={{
                        position: 'absolute', top: 0, right: 0,
                        fontFamily: GH_MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
                        padding: '6px 10px', background: GH.paper, color: GH.ink,
                        borderLeft: `1px solid ${GH.ink10}`, borderBottom: `1px solid ${GH.ink10}`,
                    }}>
                        от {specialist.basePriceGel} ₾
                    </div>
                    {/* Format badges */}
                    <div style={{ position: 'absolute', bottom: 0, left: 0, display: 'flex', gap: 0 }}>
                        {hasOnline && (
                            <span style={{
                                fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
                                padding: '5px 8px', background: GH.accent, color: GH.paper,
                                display: 'flex', alignItems: 'center', gap: 4,
                            }}>
                                <Video size={9} /> Онлайн
                            </span>
                        )}
                        {hasOffline && (
                            <span style={{
                                fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
                                padding: '5px 8px', background: GH.ink, color: GH.paper,
                                display: 'flex', alignItems: 'center', gap: 4,
                            }}>
                                {hasOfflineRoom ? <MapPin size={9} /> : <Tent size={9} />}
                                {hasOfflineRoom && hasOfflineCapsule ? 'Каб + Капс' : hasOfflineRoom ? 'Кабинет' : 'Капсула'}
                            </span>
                        )}
                    </div>
                </div>

                {/* Content */}
                <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontFamily: GH_SANS, fontSize: 16, fontWeight: 700, lineHeight: 1.2, marginBottom: 6 }}>
                        {specialist.firstName} {specialist.lastName}
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.5, color: GH.ink60, marginBottom: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {specialist.tagline}
                    </div>
                    {/* Tags */}
                    <div style={{ marginBottom: 14, flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {specialist.specializations.slice(0, 3).map((tag, i) => (
                            <span key={i} style={{
                                fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                                padding: '3px 8px', border: `1px solid ${GH.ink10}`, color: GH.ink60,
                            }}>
                                {tag}
                            </span>
                        ))}
                        {specialist.specializations.length > 3 && (
                            <span style={{
                                fontFamily: GH_MONO, fontSize: 9, padding: '3px 8px', color: GH.ink30,
                            }}>
                                +{specialist.specializations.length - 3}
                            </span>
                        )}
                    </div>
                    {/* CTA */}
                    <div style={{ borderTop: `1px solid ${GH.ink10}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: GH.accent }}>
                            Подробнее
                        </span>
                        <ArrowRight size={14} style={{ color: GH.ink30 }} />
                    </div>
                </div>
            </div>
        </Link>
    );
}
