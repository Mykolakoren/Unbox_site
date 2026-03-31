import { Brain, Stethoscope, Pill, Target, Gamepad2, ArrowRight, MapPin, Video, Users } from 'lucide-react';

const CATEGORIES = [
    { value: 'psychology',  label: 'Психологи',  icon: Brain },
    { value: 'psychiatry',  label: 'Психиатры',  icon: Stethoscope },
    { value: 'narcology',   label: 'Наркология', icon: Pill },
    { value: 'coaching',    label: 'Коучи',      icon: Target },
    { value: 'education',   label: 'Педагоги',   icon: Gamepad2 },
];

const TRUST_BADGES = [
    { icon: Users,  label: '17 специалистов' },
    { icon: MapPin, label: '2 локации в Батуми' },
    { icon: Video,  label: 'Онлайн и очно' },
];

interface Props {
    activeCategory: string | null;
    onCategorySelect: (cat: string | null) => void;
    onScrollToSpecialists: () => void;
}

const glassCard: React.CSSProperties = {
    background: 'rgba(255,255,255,0.66)',
    backdropFilter: 'blur(28px) saturate(170%)',
    WebkitBackdropFilter: 'blur(28px) saturate(170%)',
    border: '1px solid rgba(255,255,255,0.72)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.10)',
};

export function ClientHeroPanel({ activeCategory, onCategorySelect, onScrollToSpecialists }: Props) {
    return (
        <div className="rounded-3xl p-7 flex flex-col gap-6" style={glassCard}>
            {/* Headline */}
            <div>
                <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-3">Unbox · Батуми</p>
                <h1 className="text-2xl sm:text-3xl font-black text-unbox-dark leading-tight mb-3">
                    Найдите своего<br />специалиста в Батуми
                </h1>
                <p className="text-unbox-dark/55 text-sm leading-relaxed max-w-sm">
                    Психологи, терапевты, коучи и педагоги — очно в кабинете или онлайн. Просто выберите и запишитесь.
                </p>
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap gap-2">
                {TRUST_BADGES.map(b => {
                    const Icon = b.icon;
                    return (
                        <span
                            key={b.label}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-unbox-dark/65"
                            style={{ background: 'rgba(71,109,107,0.08)', border: '1px solid rgba(71,109,107,0.16)' }}
                        >
                            <Icon size={12} className="text-unbox-green" />
                            {b.label}
                        </span>
                    );
                })}
            </div>

            {/* Category filter */}
            <div>
                <p className="text-unbox-dark/40 text-[11px] font-semibold uppercase tracking-wider mb-2.5">Выбрать категорию</p>
                <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map(cat => {
                        const Icon = cat.icon;
                        const isActive = activeCategory === cat.value;
                        return (
                            <button
                                key={cat.value}
                                onClick={() => onCategorySelect(isActive ? null : cat.value)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all"
                                style={isActive ? {
                                    background: 'rgba(71,109,107,0.18)',
                                    border: '1px solid rgba(71,109,107,0.40)',
                                    color: 'rgb(44,80,78)',
                                } : {
                                    background: 'rgba(0,0,0,0.05)',
                                    border: '1px solid rgba(0,0,0,0.07)',
                                    color: 'rgba(44,50,64,0.65)',
                                }}
                            >
                                <Icon size={13} />
                                {cat.label}
                            </button>
                        );
                    })}
                    {activeCategory && (
                        <button
                            onClick={() => onCategorySelect(null)}
                            className="px-3 py-1.5 rounded-xl text-xs font-medium text-unbox-dark/35 hover:text-unbox-dark transition-colors"
                            style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }}
                        >
                            Сбросить
                        </button>
                    )}
                </div>
            </div>

            {/* CTA */}
            <button
                onClick={onScrollToSpecialists}
                className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl font-bold text-sm text-white bg-unbox-green hover:bg-unbox-dark transition-all hover:-translate-y-0.5 shadow-lg shadow-unbox-green/20"
            >
                Смотреть специалистов
                <ArrowRight size={15} />
            </button>
        </div>
    );
}
