import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    selected?: boolean;
}

export function Card({ className, selected, children, ...props }: CardProps) {
    return (
        <div
            className={twMerge(
                clsx(
                    "relative overflow-hidden rounded-2xl border transition-all duration-300 cursor-pointer premium-transition",
                    "hover:shadow-xl hover:-translate-y-1",
                    selected
                        ? "border-unbox-green bg-white shadow-lg ring-1 ring-unbox-green"
                        : "border-gray-200 bg-white/80 backdrop-blur-sm shadow-sm hover:bg-white"
                ),
                className
            )}
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
