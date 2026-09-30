import { useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { getHomePath } from '../../utils/userPaths';
import { loginPathWithRedirect } from '../../utils/loginRedirect';
import { isMobileShellPath } from '../../utils/catalogPath';
import { COLOR, FONT, MOTION, TEXT, WEIGHT, Z } from '../../design/tokens';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';

/**
 * PublicHeader — одна шапка публичных страниц (волна 2, шаг 0; G1-21, G2-17).
 *
 * Раньше у каждой публичной страницы была своя верхняя панель, а на телефоне
 * гость видел только «Специалисты · Войти» — до цен и кабинетов не добраться.
 * Теперь: логотип, «Специалисты», «Кабинеты», «Тарифы», «Войти» или имя.
 * На узком экране ссылки прячутся в кнопку «Меню» → общий Sheet.
 * Внутри мобильного приложения (/m…) шапку рисует оболочка — здесь null.
 *
 *   <PublicHeader />
 *   <PublicHeader subnav={<Link to="/articles">← Все статьи</Link>} />
 *
 * Встраивают в страницы пакеты B и C (волна 2).
 */

export interface PublicHeaderProps {
    /** Контекстная строка под шапкой («← Все статьи», хлебные крошки). */
    subnav?: ReactNode;
    /** Прилипать к верху при прокрутке. По умолчанию да. */
    sticky?: boolean;
}

type NavItem = { key: string; label: string; to: string; hash?: string };

const NAV: NavItem[] = [
    { key: 'specialists', label: 'Специалисты', to: '/specialists' },
    // Кабинеты — раздел главной (клиентский режим лендинга), отдельной
    // страницы-списка на компьютере нет.
    { key: 'cabinets', label: 'Кабинеты', to: '/#cabinets', hash: 'cabinets' },
    { key: 'tariffs', label: 'Тарифы', to: '/subscriptions' },
];

const HAIRLINE = `1px solid ${COLOR.ink10}`;

const LINK_STYLE: CSSProperties = {
    fontFamily: FONT.mono,
    fontSize: TEXT.caption,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: COLOR.ink60,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    padding: '4px 12px',
    minHeight: 36,
    display: 'inline-flex',
    alignItems: 'center',
};

const ACTIVE_STYLE: CSSProperties = { color: COLOR.ink, fontWeight: WEIGHT.semibold };

/** «Кабинеты» — якорь главной: на главной прокручиваем, иначе идём на неё
 *  в клиентском режиме (как ссылка «Кабинеты» в шапке лендинга). */
function goToHash(e: MouseEvent, item: NavItem, fromSheet: boolean) {
    if (!item.hash) return;
    e.preventDefault();
    const el = document.getElementById(item.hash);
    if (el) {
        // Из шторки — после того как она закроется и снимет блокировку прокрутки.
        const scroll = () => el.scrollIntoView({ behavior: 'smooth' });
        if (fromSheet) window.setTimeout(scroll, MOTION.sheetOut + 40); else scroll();
        return;
    }
    try { localStorage.setItem('unbox_visitor_mode', 'client'); } catch { /* приватный режим */ }
    window.location.href = item.to;
}

function firstName(name?: string | null): string {
    const n = (name ?? '').trim();
    return n ? n.split(/\s+/)[0] : 'Кабинет';
}

export function PublicHeader({ subnav, sticky = true }: PublicHeaderProps) {
    const location = useLocation();
    const isDesktop = useIsDesktop();
    const currentUser = useUserStore(s => s.currentUser);
    const [menuOpen, setMenuOpen] = useState(false);

    if (isMobileShellPath(location.pathname)) return null;

    const isActive = (item: NavItem) =>
        item.hash
            ? location.pathname === '/' && location.hash === `#${item.hash}`
            : location.pathname === item.to || location.pathname.startsWith(item.to + '/');

    const account = currentUser
        ? { label: firstName(currentUser.name), to: getHomePath(currentUser), title: currentUser.name ?? undefined }
        : { label: 'Войти', to: loginPathWithRedirect(location.pathname + location.search + location.hash), title: undefined };

    const navLink = (item: NavItem, style: CSSProperties, onNavigate?: () => void) => {
        const active = isActive(item);
        const s = active ? { ...style, ...ACTIVE_STYLE } : style;
        if (item.hash) {
            return (
                <a
                    key={item.key}
                    href={item.to}
                    style={s}
                    aria-current={active ? 'page' : undefined}
                    onClick={(e) => { onNavigate?.(); goToHash(e, item, !!onNavigate); }}
                >
                    {item.label}
                </a>
            );
        }
        return (
            <Link key={item.key} to={item.to} style={s} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
                {item.label}
            </Link>
        );
    };

    const sheetLinkStyle: CSSProperties = {
        fontFamily: FONT.sans,
        fontSize: TEXT.body,
        color: COLOR.ink,
        textDecoration: 'none',
        minHeight: 44,
        display: 'flex',
        alignItems: 'center',
        borderBottom: HAIRLINE,
    };

    return (
        <header
            style={{
                background: COLOR.paper,
                borderBottom: HAIRLINE,
                fontFamily: FONT.sans,
                ...(sticky ? { position: 'sticky', top: 0, zIndex: Z.sticky } : {}),
            }}
        >
            <div
                style={{
                    maxWidth: 1280,
                    margin: '0 auto',
                    padding: isDesktop ? '16px 32px' : '8px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                }}
            >
                <Link
                    to="/"
                    aria-label="Unbox — на главную"
                    style={{
                        fontSize: TEXT.title,
                        fontWeight: WEIGHT.semibold,
                        letterSpacing: '-0.01em',
                        color: COLOR.ink,
                        textDecoration: 'none',
                        minHeight: 44,
                        display: 'inline-flex',
                        alignItems: 'center',
                    }}
                >
                    Unbox
                </Link>

                {isDesktop ? (
                    <nav aria-label="Основное меню" style={{ display: 'flex', alignItems: 'center' }}>
                        {NAV.map(item => navLink(item, LINK_STYLE))}
                        <span aria-hidden="true" style={{ width: 1, height: 16, background: COLOR.ink10, margin: '0 8px' }} />
                        <Link
                            to={account.to}
                            title={account.title}
                            style={{
                                ...LINK_STYLE,
                                color: COLOR.ink,
                                fontWeight: WEIGHT.semibold,
                                maxWidth: 180,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                display: 'inline-block',
                                lineHeight: '28px',
                            }}
                        >
                            {account.label}
                        </Link>
                    </nav>
                ) : (
                    <Button
                        variant="secondary"
                        size="touch"
                        icon={<Menu size={18} aria-hidden="true" />}
                        aria-haspopup="dialog"
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen(true)}
                    >
                        Меню
                    </Button>
                )}
            </div>

            {subnav && (
                <div
                    style={{
                        borderTop: HAIRLINE,
                        maxWidth: 1280,
                        margin: '0 auto',
                        padding: isDesktop ? '8px 32px' : '8px 16px',
                        fontSize: TEXT.small,
                        color: COLOR.ink60,
                    }}
                >
                    {subnav}
                </div>
            )}

            {!isDesktop && (
                <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Меню">
                    <nav aria-label="Основное меню" style={{ display: 'flex', flexDirection: 'column' }}>
                        {NAV.map(item => navLink(item, sheetLinkStyle, () => setMenuOpen(false)))}
                        <Link
                            to={account.to}
                            onClick={() => setMenuOpen(false)}
                            style={{ ...sheetLinkStyle, fontWeight: WEIGHT.semibold, borderBottom: 'none' }}
                        >
                            {currentUser ? `${account.label} · личный кабинет` : 'Войти'}
                        </Link>
                    </nav>
                </Sheet>
            )}
        </header>
    );
}
