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
                    "relative overflow-hidden rounded-2xl border transition-all duration-300 cursor-pointer",
                    "hover:shadow-lg hover:-translate-y-1",
                    selected
                        ? "border-black bg-gray-50 shadow-md ring-1 ring-black"
                        : "border-gray-200 bg-white shadow-sm"
                ),
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}
