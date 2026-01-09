import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
}

export function Button({
    className,
    variant = 'primary',
    size = 'md',
    ...props
}: ButtonProps) {
    return (
        <button
            className={twMerge(
                clsx(
                    "inline-flex items-center justify-center rounded-xl font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none",
                    {
                        'bg-unbox-green text-white hover:bg-unbox-dark focus:ring-unbox-green': variant === 'primary',
                        'bg-unbox-light text-unbox-dark hover:bg-white border border-transparent hover:border-unbox-light focus:ring-unbox-grey': variant === 'secondary',
                        'border-2 border-unbox-green text-unbox-green hover:bg-unbox-green hover:text-white': variant === 'outline',
                        'text-unbox-grey hover:text-unbox-dark': variant === 'ghost',

                        'h-9 px-4 text-sm': size === 'sm',
                        'h-11 px-6 text-base': size === 'md',
                        'h-14 px-8 text-lg': size === 'lg',
                    }
                ),
                className
            )}
            {...props}
        />
    );
}
