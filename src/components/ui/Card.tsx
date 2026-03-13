import React from 'react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    selected?: boolean;
}

export function Card({ className, selected, children, style, ...props }: CardProps) {
    const glassStyle: React.CSSProperties = selected ? {
        background: 'rgba(212,226,225,0.55)',
        backdropFilter: 'blur(20px) saturate(150%)',
        WebkitBackdropFilter: 'blur(20px) saturate(150%)',
    } : {
        background: 'rgba(255,255,255,0.45)',
        backdropFilter: 'blur(20px) saturate(140%)',
        WebkitBackdropFilter: 'blur(20px) saturate(140%)',
    };

    return (
        <div
            className={twMerge(
                clsx(
                    "relative overflow-hidden rounded-2xl border transition-all duration-300 cursor-pointer premium-transition",
                    "hover:shadow-xl hover:-translate-y-1",
                    selected
                        ? "border-unbox-green/50 shadow-lg ring-1 ring-unbox-green/40"
                        : "border-white/60 shadow-sm hover:shadow-md"
                ),
                className
            )}
            style={{ ...glassStyle, ...style }}
            {...props}
        >
            {/* Subtle Gradient Overlay for premium feel */}
            {selected && (
                <div className="absolute inset-0 bg-gradient-to-br from-unbox-green/5 to-transparent pointer-events-none" />
            )}
            {children}
        </div>
    );
}
