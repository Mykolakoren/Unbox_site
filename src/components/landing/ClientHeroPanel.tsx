import { Brain, Stethoscope, Pill, Target, Gamepad2 } from 'lucide-react';

const CATEGORIES = [
    { value: 'psychology',  label: 'Психологи',      icon: Brain },
    { value: 'psychiatry',  label: 'Психиатры',      icon: Stethoscope },
    { value: 'narcology',   label: 'Наркология',     icon: Pill },
    { value: 'coaching',    label: 'Коучи',          icon: Target },
    { value: 'education',   label: 'Педагоги',        icon: Gamepad2 },
];

interface Props {
    activeCategory: string | null;
    onCategorySelect: (cat: string | null) => void;
}

const glassCard: React.CSSProperties = {
    background: 'rgba(255,255,255,0.62)',
    backdropFilter: 'blur(24px) saturate(160%)',
    WebkitBackdropFilter: 'blur(24px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.70)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
};

export function ClientHeroPanel({ activeCategory, onCategorySelect }: Props) {
    return (
        <div className="rounded-3xl p-6 flex flex-col gap-5" style={glassCard}>
            {/* Heading */}
            <div>
                <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-2">Каталог</p>
                <h2 className="text-xl sm:text-2xl font-bold text-unbox-dark leading-tight">
                    Найдите своего специалиста
                </h2>
                <p className="text-unbox-dark/50 text-sm mt-1">
                    Кабинеты и капсулы в двух локациях Батуми
                </p>
            </div>

            {/* Category pills */}
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
                                background: 'rgba(0,0,0,0.06)',
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
                        className="px-3 py-1.5 rounded-xl text-xs font-medium text-unbox-dark/40 hover:text-unbox-dark transition-colors"
                        style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }}
                    >
                        Сбросить
                    </button>
                )}
            </div>

            {/* Hint */}
            <p className="text-xs text-unbox-dark/35 -mt-2">
                Нажмите на категорию, чтобы отфильтровать специалистов ↓
            </p>
        </div>
    );
}
