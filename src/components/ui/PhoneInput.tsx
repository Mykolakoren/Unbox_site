import { forwardRef, useCallback } from 'react';

/**
 * Phone input with Georgia mobile mask "+995 XXX XX XX XX".
 * Accepts any `value`/`onChange` contract that a normal <input> does, but
 * normalises the text on every change so the caller always gets a cleanly
 * formatted string. Pure controlled component, no dependencies.
 *
 * Excel #39 tail — replaces raw <input type="tel"/> across the app.
 */

/** Format any raw input into "+995 XXX XX XX XX" up to 12 digits total. */
export function formatGeorgiaPhone(raw: string): string {
    // Strip everything except digits, then drop leading 995 if the user typed it,
    // so the rest of the formatter always works with the "local" 9-digit part.
    let digits = (raw || '').replace(/\D/g, '');
    if (digits.startsWith('995')) digits = digits.slice(3);
    // Cap at 9 local digits
    digits = digits.slice(0, 9);

    if (!digits) return '';

    // Pieces: XXX XX XX XX (3-2-2-2)
    const parts: string[] = [];
    if (digits.length > 0) parts.push(digits.slice(0, 3));
    if (digits.length > 3) parts.push(digits.slice(3, 5));
    if (digits.length > 5) parts.push(digits.slice(5, 7));
    if (digits.length > 7) parts.push(digits.slice(7, 9));

    return `+995 ${parts.join(' ')}`.trimEnd();
}

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
    value: string;
    onChange: (value: string) => void;
};

export const PhoneInput = forwardRef<HTMLInputElement, Props>(function PhoneInput(
    { value, onChange, placeholder = '+995 555 00 00 00', className, ...rest },
    ref,
) {
    const handle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(formatGeorgiaPhone(e.target.value));
    }, [onChange]);

    return (
        <input
            ref={ref}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={value}
            onChange={handle}
            placeholder={placeholder}
            className={className}
            {...rest}
        />
    );
});
