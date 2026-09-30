import type { ReactNode } from 'react';

/**
 * Ссылка на полную (компьютерную) страницу админки — «Открыть полную статью →».
 *
 * На телефоне App.tsx перенаправляет любой /admin/* обратно в /m/admin; выйти
 * в полную версию можно только явным ?forceDesktop=1 (так владелец оставил
 * этот выход для админов 02.06). Без параметра ссылка водила по кругу —
 * аудит G9-06. Открывается в той же вкладке; зона нажатия 44 px.
 */
export function DesktopLink({ href, children }: { href: string; children: ReactNode }) {
    const url = `${href}${href.includes('?') ? '&' : '?'}forceDesktop=1`;
    return (
        <a
            href={url}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 44,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--color-ink)',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
            }}
        >
            {children}
        </a>
    );
}
