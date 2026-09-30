/**
 * Russian plural form for a count.
 *
 *   ruPlural(1,  ['бронь', 'брони', 'броней'])   → "бронь"
 *   ruPlural(2,  ['бронь', 'брони', 'броней'])   → "брони"
 *   ruPlural(5,  ['бронь', 'брони', 'броней'])   → "броней"  (genitive plural; 11–14 special-cased)
 *   ruPlural(11, ['бронь', 'брони', 'броней'])   → "броней"
 *   ruPlural(21, ['бронь', 'брони', 'броней'])   → "бронь"
 *
 * Forms (Russian three-form pluralization):
 *   one   — applies to 1, 21, 31, …  (but NOT 11)
 *   few   — applies to 2-4, 22-24, … (but NOT 12-14)
 *   many  — applies to 0, 5-20, 25-30, …
 *
 * Third form is the genitive plural («5 броней», «5 сессий»), NOT the
 * singular again — repeating «бронь» there gives «Отменено 5 бронь».
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
 *   ruCountWord(3, ['бронь', 'брони', 'броней']) → "3 брони"
 */
export function ruCountWord(n: number, forms: [string, string, string]): string {
    return `${n} ${ruPlural(n, forms)}`;
}
