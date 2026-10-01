import { Link } from 'react-router-dom';
import { Video, MapPin, Tent, ArrowRight } from 'lucide-react';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { getBadge } from '../../utils/specialistBadges';
import { formatGel } from '../../utils/format';
import { useCatalogPath } from '../../utils/catalogPath';
import {
    hasOnlineFormat, hasOfflineFormat,
    hasOfflineRoom as hasOfflineRoomFmt,
    hasOfflineCapsule as hasOfflineCapsuleFmt,
    specializationLabels,
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
    badges?: string[];
    /** Категория каталога: psychology | psychiatry | narcology | coaching | education. */
    category?: string | null;
}

interface SpecialistCardProps {
    specialist: Specialist;
    /** Узкий экран: две колонки, фото 1:1, формат строкой под именем (G2-07). */
    compact?: boolean;
}

export function SpecialistCard({ specialist, compact = false }: SpecialistCardProps) {
    const hasOnline = hasOnlineFormat(specialist.formats);
    const hasOfflineRoom = hasOfflineRoomFmt(specialist.formats);
    const hasOfflineCapsule = hasOfflineCapsuleFmt(specialist.formats);
    const hasOffline = hasOfflineFormat(specialist.formats);

    return (
        <GHCard
            specialist={specialist}
            compact={compact}
            hasOnline={hasOnline}
            hasOffline={hasOffline}
            hasOfflineRoom={hasOfflineRoom}
            hasOfflineCapsule={hasOfflineCapsule}
        />
    );
}

/* ═══ Grid House Card ═══ */

const MONO_TAG: React.CSSProperties = {
    fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
};

function GHCard({ specialist, compact, hasOnline, hasOffline, hasOfflineRoom, hasOfflineCapsule }: {
    specialist: Specialist; compact: boolean; hasOnline: boolean; hasOffline: boolean; hasOfflineRoom: boolean; hasOfflineCapsule: boolean;
}) {
    const toCatalog = useCatalogPath();
    // G2-08: служебные ключи (GENERAL_PSYCHOLOGY) → русские названия,
    // неизвестная латиница скрыта.
    const tags = specializationLabels(specialist.specializations);
    const maxTags = compact ? 2 : 3;
    const price = specialist.basePriceGel > 0 ? specialist.basePriceGel : null;
    const offlineLabel = hasOfflineRoom && hasOfflineCapsule ? 'Кабинет, капсула' : hasOfflineRoom ? 'Кабинет' : 'Капсула';
    const formatText = [hasOnline && 'Онлайн', hasOffline && offlineLabel].filter(Boolean).join(' · ');
    const initials = `${specialist.firstName?.[0] ?? ''}${specialist.lastName?.[0] ?? ''}`.toUpperCase();

    return (
        <Link to={toCatalog(`/specialists/${specialist.id}`)} style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>
            <div style={{
                height: '100%', display: 'flex', flexDirection: 'column',
                border: `1px solid ${GH.ink10}`, background: GH.paper,
                transition: 'border-color 0.2s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = GH.ink; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = GH.ink10; }}
            >
                {/* Photo */}
                <div style={{ position: 'relative', aspectRatio: compact ? '1 / 1' : '3 / 4', overflow: 'hidden', background: GH.ink5 }}>
                    {specialist.photoUrl ? (
                        <img src={specialist.photoUrl} alt="" loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                        <div aria-hidden="true" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: compact ? 28 : 40, fontWeight: 600, color: GH.ink60 }}>
                            {initials}
                        </div>
                    )}
                    {/* Price. Без цены (0) — не показываем «от 0 ₾». */}
                    {price !== null && !compact && (
                        <div style={{
                            position: 'absolute', top: 0, right: 0,
                            ...MONO_TAG, fontWeight: 600, textTransform: 'none',
                            padding: '6px 10px', background: GH.paper, color: GH.ink,
                            borderLeft: `1px solid ${GH.ink10}`, borderBottom: `1px solid ${GH.ink10}`,
                        }}>
                            от {formatGel(price)}
                        </div>
                    )}
                    {/* Format badges */}
                    {!compact && (
                        <div style={{ position: 'absolute', bottom: 0, left: 0, display: 'flex', gap: 0 }}>
                            {hasOnline && (
                                <span style={{
                                    ...MONO_TAG,
                                    padding: '5px 8px', background: GH.accent, color: GH.paper,
                                    display: 'flex', alignItems: 'center', gap: 4,
                                }}>
                                    <Video size={12} aria-hidden="true" /> Онлайн
                                </span>
                            )}
                            {hasOffline && (
                                <span style={{
                                    ...MONO_TAG,
                                    padding: '5px 8px', background: GH.ink, color: GH.paper,
                                    display: 'flex', alignItems: 'center', gap: 4,
                                }}>
                                    {hasOfflineRoom ? <MapPin size={12} aria-hidden="true" /> : <Tent size={12} aria-hidden="true" />}
                                    {hasOfflineRoom && hasOfflineCapsule ? 'Каб + Капс' : hasOfflineRoom ? 'Кабинет' : 'Капсула'}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Content */}
                <div style={{ padding: compact ? '10px 12px' : '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {(specialist.badges || []).length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                            {(specialist.badges || []).map(code => {
                                const b = getBadge(code);
                                if (!b) return null;
                                return (
                                    <span key={code} style={{
                                        ...MONO_TAG, fontWeight: 600,
                                        padding: '3px 7px', color: b.fg, background: b.bg,
                                        border: `1px solid ${b.border}`,
                                    }}>{b.label}</span>
                                );
                            })}
                        </div>
                    )}
                    <div style={{ fontFamily: GH_SANS, fontSize: 16, fontWeight: 600, lineHeight: 1.2, marginBottom: 6 }}>
                        {specialist.firstName} {specialist.lastName}
                    </div>
                    <div style={{ fontSize: compact ? 12 : 14, lineHeight: 1.45, color: GH.ink60, marginBottom: compact ? 6 : 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {specialist.tagline}
                    </div>
                    {compact ? (
                        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {formatText && <div style={{ fontSize: 12, color: GH.ink60 }}>{formatText}</div>}
                            {price !== null && (
                                <div className="num" style={{ fontFamily: GH_MONO, fontSize: 14, fontWeight: 600, color: GH.ink, fontVariantNumeric: 'tabular-nums' }}>
                                    от {formatGel(price)}
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* Tags */}
                            <div style={{ marginBottom: 14, flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'flex-start' }}>
                                {tags.slice(0, maxTags).map(tag => (
                                    <span key={tag} style={{
                                        fontSize: 12, lineHeight: 1.4,
                                        padding: '3px 8px', border: `1px solid ${GH.ink10}`, color: GH.ink60,
                                    }}>
                                        {tag}
                                    </span>
                                ))}
                                {tags.length > maxTags && (
                                    <span style={{ fontSize: 12, padding: '3px 8px', color: GH.ink60 }}>
                                        +{tags.length - maxTags}
                                    </span>
                                )}
                            </div>
                            {/* CTA */}
                            <div style={{ borderTop: `1px solid ${GH.ink10}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ ...MONO_TAG, color: GH.accent }}>
                                    Подробнее
                                </span>
                                <ArrowRight size={14} aria-hidden="true" style={{ color: GH.ink60 }} />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </Link>
    );
}
