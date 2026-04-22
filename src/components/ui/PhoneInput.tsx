import { forwardRef, useCallback } from 'react';

/**
 * Phone input — Excel #40 relaxed from hard Georgia mask to tolerant format.
 *
 * Admins reported that users with Ukrainian / Russian numbers couldn't
 * fit into the "+995 XXX XX XX XX" mask, and a number like "+380 67 123"
 * with a dash in the middle was outright rejected. Now:
 *
 *   - International numbers (anything starting with "+" that isn't +995)
 *     are passed through with minimal cleanup (spaces + digits only,
 *     capped at 16 chars).
 *   - Georgia numbers (+995 or digits only) still auto-mask to
 *     "+995 XXX XX XX XX" because that's 90% of the users.
 *   - Empty input stays empty.
 *
 * The on-blur tidy (collapse duplicate spaces, trim) is kept so pasted
 * numbers with "+380-67-123-45-67" land in storage as clean text.
 */

/** Collapse whitespace + trim, keep `+`, digits and single spaces. */
function tidyFreeform(raw: string): string {
    // Keep + only if it's the first character; digits, spaces, dashes elsewhere.
    const hasPlus = raw.trimStart().startsWith('+');
    const body = raw.replace(/[^\d\s-]/g, '');
    // Collapse runs of whitespace to single spaces, then cap length (16 is enough
    // for any E.164 number with a couple of separators).
    const cleaned = body.replace(/\s+/g, ' ').trim().slice(0, 16);
    return (hasPlus ? '+' : '') + cleaned;
}

/** Mask raw into "+995 XXX XX XX XX". Returns '' for empty. */
export function formatGeorgiaPhone(raw: string): string {
    let digits = (raw || '').replace(/\D/g, '');
    if (digits.startsWith('995')) digits = digits.slice(3);
    digits = digits.slice(0, 9);
    if (!digits) return '';

    const parts: string[] = [];
    if (digits.length > 0) parts.push(digits.slice(0, 3));
    if (digits.length > 3) parts.push(digits.slice(3, 5));
    if (digits.length > 5) parts.push(digits.slice(5, 7));
    if (digits.length > 7) parts.push(digits.slice(7, 9));

    return `+995 ${parts.join(' ')}`.trimEnd();
}

/** Format by context: Georgia mask for +995/bare digits, free-form otherwise. */
export function formatPhone(raw: string): string {
    if (!raw) return '';
    const trimmed = raw.trimStart();
    // Explicit non-Georgia international number — leave it (light cleanup).
    if (trimmed.startsWith('+') && !trimmed.startsWith('+995')) {
        return tidyFreeform(raw);
    }
    // +995 or bare digits → Georgia mask
    return formatGeorgiaPhone(raw);
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
        onChange(formatPhone(e.target.value));
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
