/**
 * Russian plural form for a count.
 *
 *   ru(1, 'бронь', 'брони', 'бронь')        → "бронь"
 *   ru(2, 'бронь', 'брони', 'бронь')        → "брони"
 *   ru(5, 'бронь', 'брони', 'бронь')        → "бронь"   (genitive plural; 11–14 special-cased)
 *   ru(21, 'бронь', 'брони', 'бронь')       → "бронь"
 *
 * Forms (Russian three-form pluralization):
 *   one   — applies to 1, 21, 31, …  (but NOT 11)
 *   few   — applies to 2-4, 22-24, … (but NOT 12-14)
 *   many  — applies to 0, 5-20, 25-30, …
 *
 * Use `ruPlural(count, ['бронь', 'брони', 'бронь'])` for the array variant
 * which is easier to pass into translation tables.
 */
export function ruPlural(n: number, forms: [string, string, string]): string {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (last > 1 && last < 5) return forms[1];
    if (last === 1) return forms[0];
    return forms[2];
}

/** Common shortcut: returns `"N word"` with correct plural form.
 *
 *   ruCountWord(3, ['бронь', 'брони', 'бронь']) → "3 брони"
 */
export function ruCountWord(n: number, forms: [string, string, string]): string {
    return `${n} ${ruPlural(n, forms)}`;
}
