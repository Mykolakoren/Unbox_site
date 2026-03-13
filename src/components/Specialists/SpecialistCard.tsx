import { Link } from 'react-router-dom';
import { User, Video, MapPin, Tent } from 'lucide-react';
import { Card } from '../ui/Card';

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
    const hasOnline = specialist.formats.includes('ONLINE');
    const hasOfflineRoom = specialist.formats.includes('OFFLINE_ROOM');
    const hasOfflineCapsule = specialist.formats.includes('OFFLINE_CAPSULE');

    return (
        <Card className="h-full flex flex-col hover:shadow-lg transition-all duration-300 border border-unbox-light/50 group overflow-hidden">
            {/* Image Section */}
            <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-unbox-light to-white">
                {specialist.photoUrl ? (
                    <img
                        src={specialist.photoUrl}
                        alt={`${specialist.firstName} ${specialist.lastName}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-unbox-grey group-hover:scale-105 transition-transform duration-500">
                        <User size={64} strokeWidth={1.5} />
                    </div>
                )}

                {/* Price Badge */}
                <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm text-sm font-bold text-unbox-dark border border-white/50">
                    от {specialist.basePriceGel} ₾
                </div>
            </div>

            {/* Content Section */}
            <div className="p-5 flex-1 flex flex-col">
                <h3 className="text-xl font-bold text-unbox-dark leading-tight mb-1">
                    {specialist.firstName} {specialist.lastName}
                </h3>

                <p className="text-sm border-l-2 border-unbox-green/30 pl-3 py-0.5 text-unbox-grey mb-4 line-clamp-2">
                    {specialist.tagline}
                </p>

                {/* Formats */}
                <div className="flex flex-wrap gap-2 mb-4">
                    {hasOnline && (
                        <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 bg-unbox-light text-unbox-green rounded-md">
                            <Video size={12} />
                            Онлайн
                        </span>
                    )}
                    {(hasOfflineRoom || hasOfflineCapsule) && (
                        <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 bg-unbox-light text-unbox-dark rounded-md">
                            {hasOfflineRoom ? <MapPin size={12} /> : <Tent size={12} />}
                            {hasOfflineRoom && hasOfflineCapsule ? 'Офлайн (все форматы)' : hasOfflineRoom ? 'Кабинет' : 'Капсула'}
                        </span>
                    )}
                </div>

                {/* Tags Section */}
                <div className="mb-6 flex-1">
                    <div className="flex flex-wrap gap-1.5 line-clamp-2">
                        {specialist.specializations.slice(0, 3).map((tag, idx) => (
                            <span
                                key={idx}
                                className="text-[11px] px-2 py-1 bg-unbox-light/50 text-unbox-grey rounded-full border border-unbox-light"
                            >
                                {tag}
                            </span>
                        ))}
                        {specialist.specializations.length > 3 && (
                            <span className="text-[11px] px-2 py-1 bg-unbox-light/50 text-unbox-grey rounded-full border border-unbox-light">
                                +{specialist.specializations.length - 3}
                            </span>
                        )}
                    </div>
                </div>

                {/* Action Button */}
                <Link
                    to={`/specialists/${specialist.id}`}
                    className="w-full block text-center py-2.5 px-4 bg-unbox-light/50 hover:bg-unbox-dark text-unbox-dark hover:text-white text-sm font-semibold rounded-xl transition-colors duration-200"
                >
                    Подробнее
                </Link>
            </div>
        </Card>
    );
}
