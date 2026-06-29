import { Link } from 'react-router-dom';
import { User, Video, MapPin, Tent, ArrowRight } from 'lucide-react';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import {
    hasOnlineFormat, hasOfflineFormat,
    hasOfflineRoom as hasOfflineRoomFmt,
    hasOfflineCapsule as hasOfflineCapsuleFmt,
} from '../../utils/specialistFormat';

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
    sessionDurationMin?: number;
}

interface SpecialistCardProps {
    specialist: Specialist;
}

export function SpecialistCard({ specialist }: SpecialistCardProps) {
    const hasOnline = hasOnlineFormat(specialist.formats);
    const hasOfflineRoom = hasOfflineRoomFmt(specialist.formats);
    const hasOfflineCapsule = hasOfflineCapsuleFmt(specialist.formats);
    const hasOffline = hasOfflineFormat(specialist.formats);

    return <GHCard specialist={specialist} hasOnline={hasOnline} hasOffline={hasOffline} hasOfflineRoom={hasOfflineRoom} hasOfflineCapsule={hasOfflineCapsule} />;
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
