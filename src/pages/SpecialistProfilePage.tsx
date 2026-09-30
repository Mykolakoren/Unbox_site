import { useState, useEffect, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Check, Instagram, Send, Globe } from 'lucide-react';
import { api } from '../api/client';
import type { Specialist } from '../components/Specialists/SpecialistCard';
import { SpecialistBookingChessboardGrid } from '../components/Specialists/SpecialistBookingChessboardGrid';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
// 2026-06-13 owner: рендер структурированного текста вынесен в общий
// компонент StructuredText (переиспользуется новостями/статьями).
import { StructuredText } from '../components/StructuredText';
import { hasOnlineFormat, hasOfflineFormat, specializationLabels } from '../utils/specialistFormat';
import { getBadge } from '../utils/specialistBadges';
import { formatGel } from '../utils/format';
import { ruCountWord } from '../utils/plural';
import { PublicHeader } from '../components/public/PublicHeader';
import { Button } from '../components/ui/Button';
import { Skeleton, SkeletonText } from '../components/ui/Skeleton';
import { useCatalogPath, useInMobileShell } from '../utils/catalogPath';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Z } from '../design/tokens';

/** Нормализует контакт (@handle или ссылка) в {href, label} для профиля. */
function normalizeContact(
    raw: string | null | undefined,
    kind: 'instagram' | 'telegram' | 'website',
): { href: string; label: string } | null {
    const v = (raw || '').trim();
    if (!v) return null;
    const isUrl = /^https?:\/\//i.test(v);
    if (kind === 'website') {
        const href = isUrl ? v : `https://${v}`;
        return { href, label: v.replace(/^https?:\/\//i, '').replace(/\/$/, '') };
    }
    const handle = v.replace(/^@/, '').replace(/^https?:\/\/(www\.)?(instagram\.com|t\.me|telegram\.me)\//i, '').replace(/\/$/, '');
    const base = kind === 'instagram' ? 'https://instagram.com/' : 'https://t.me/';
    const href = isUrl ? v : `${base}${handle}`;
    return { href, label: `@${handle}` };
}

function ContactLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
    return (
        <a href={href} target="_blank" rel="noreferrer"
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                fontFamily: GH_MONO, fontSize: 14, color: GH.ink, textDecoration: 'none',
                padding: '0 12px', minHeight: 44, border: `1px solid ${GH.ink10}`,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = GH.ink; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = GH.ink10; }}
        >
            {icon}{label}
        </a>
    );
}

// Per-center offline tags (new in May 2026 — see CrmProfile FormatCheckbox).
const PROFILE_LOCATIONS = [
    { tag: 'OFFLINE_UNBOX_ONE',  id: 'unbox_one',  label: 'Unbox One' },
    { tag: 'OFFLINE_UNBOX_UNI',  id: 'unbox_uni',  label: 'Unbox Uni' },
    { tag: 'OFFLINE_NEO_SCHOOL', id: 'neo_school', label: 'Neo School' },
];

const monoLabel: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 12,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: GH.ink60,
    fontWeight: 500,
};

const sectionHead: React.CSSProperties = {
    fontFamily: GH_SANS,
    fontSize: 28,
    fontWeight: 600,
    letterSpacing: '-0.015em',
    margin: 0,
    color: GH.ink,
};

function scrollToSlots() {
    const el = document.getElementById('specialist-slots');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function SpecialistProfilePage() {
    const { id } = useParams<{ id: string }>();
    const [specialist, setSpecialist] = useState<Specialist | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const inShell = useInMobileShell();
    const toCatalog = useCatalogPath();

    // Grid House: track narrow viewport for responsive collapse
    const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 960);
    useEffect(() => {
        const onResize = () => setIsNarrow(window.innerWidth < 960);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // Липкая «Записаться» прячется, когда блок записи уже на экране.
    const [slotsInView, setSlotsInView] = useState(false);
    useEffect(() => {
        if (!specialist || typeof IntersectionObserver === 'undefined') return;
        const el = document.getElementById('specialist-slots');
        if (!el) return;
        const obs = new IntersectionObserver(([entry]) => setSlotsInView(entry.isIntersecting), { threshold: 0.05 });
        obs.observe(el);
        return () => obs.disconnect();
    }, [specialist]);

    useDocumentTitle(specialist ? `${specialist.firstName} ${specialist.lastName}` : 'Специалист');

    useEffect(() => {
        let alive = true;
        setIsLoading(true);
        setError(null);
        api.get(`/specialists/${id}`)
            .then(res => { if (alive) setSpecialist(res.data); })
            .catch(() => { if (alive) setError('Специалист не найден или страница удалена.'); })
            .finally(() => { if (alive) setIsLoading(false); });
        return () => { alive = false; };
    }, [id]);

    const pagePad = isNarrow ? '0 16px' : '0 32px';
    const pageStyle: React.CSSProperties = {
        minHeight: '100vh',
        background: GH.paper,
        color: GH.ink,
        fontFamily: GH_SANS,
        // Внутри /m шапку рисует оболочка — раньше тут было 104 px пустоты.
        paddingTop: inShell ? 16 : 0,
        paddingBottom: isNarrow ? 120 : 96,
    };

    const backLink = (
        <Link
            to={toCatalog('/specialists')}
            style={{ ...monoLabel, color: GH.ink, textDecoration: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
        >
            ← Все специалисты
        </Link>
    );

    // G2-23: пока грузим — скелетон на бумаге, а не мятный фон со спиннером.
    if (isLoading) {
        return (
            <div style={pageStyle}>
                <PublicHeader />
                <div role="status" aria-busy="true" style={{ maxWidth: 1280, margin: '0 auto', padding: pagePad }}>
                    <span className="sr-only">Загружаем профиль…</span>
                    <div style={{ padding: '16px 0 32px' }}><Skeleton height={16} width={160} /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : 'minmax(0, 4fr) minmax(0, 8fr)', gap: isNarrow ? 24 : 56 }}>
                        <Skeleton height={isNarrow ? 240 : 480} radius={0} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <Skeleton height={56} width="70%" />
                            <Skeleton height={20} width="50%" />
                            <SkeletonText lines={4} />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (error || !specialist) {
        return (
            <div style={pageStyle}>
                <PublicHeader />
                <div style={{ maxWidth: 640, margin: '0 auto', padding: isNarrow ? '48px 16px' : '96px 32px' }}>
                    <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.01em', margin: '0 0 12px' }}>
                        Специалист не найден
                    </h1>
                    <p style={{ fontSize: 16, lineHeight: 1.5, color: GH.ink60, margin: '0 0 24px' }}>
                        {error || 'Страница удалена или ссылка устарела.'} Посмотрите других специалистов Unbox.
                    </p>
                    <Link to={toCatalog('/specialists')} className="ui-btn ui-btn--primary" style={{ textDecoration: 'none' }}>
                        Все специалисты →
                    </Link>
                </div>
            </div>
        );
    }

    const hasOnline = hasOnlineFormat(specialist.formats);
    const selectedCenters = PROFILE_LOCATIONS.filter(l => specialist.formats.includes(l.tag));
    // 2026-06-24 fix: ловим ЛЮБОЙ код, начинающийся с OFFLINE.
    const hasAnyOffline = hasOfflineFormat(specialist.formats);
    const price = specialist.basePriceGel > 0 ? specialist.basePriceGel : null;
    const duration = specialist.sessionDurationMin ?? 50;
    const formatLabel = [hasOnline && 'Онлайн', hasAnyOffline && 'Очно'].filter(Boolean).join(' · ');
    // G2-08: направления — русскими названиями, служебные ключи скрыты.
    const practice = specializationLabels(specialist.specializations);
    const fullName = `${specialist.firstName} ${specialist.lastName}`;

    const badges = (specialist.badges || []).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {(specialist.badges || []).map(code => {
                const b = getBadge(code);
                if (!b) return null;
                return (
                    <span key={code} style={{
                        fontFamily: GH_MONO, fontSize: 12, fontWeight: 600,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        padding: '5px 10px', color: b.fg, background: b.bg,
                        border: `1px solid ${b.border}`,
                    }}>{b.label}</span>
                );
            })}
        </div>
    );

    const contacts = (() => {
        const sp = specialist as Specialist & { instagram?: string; telegram?: string; website?: string };
        const ig = normalizeContact(sp.instagram, 'instagram');
        const tg = normalizeContact(sp.telegram, 'telegram');
        const web = normalizeContact(sp.website, 'website');
        if (!ig && !tg && !web) return null;
        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
                {ig && <ContactLink href={ig.href} icon={<Instagram size={16} aria-hidden="true" />} label={ig.label} />}
                {tg && <ContactLink href={tg.href} icon={<Send size={16} aria-hidden="true" />} label={tg.label} />}
                {web && <ContactLink href={web.href} icon={<Globe size={16} aria-hidden="true" />} label={web.label} />}
            </div>
        );
    })();

    // G2-03: на телефоне первым — имя, роль и строка «200 ₾ · 50 мин · Онлайн».
    const nameHeader = (
        <header style={{ marginBottom: isNarrow ? 24 : 40 }}>
            {badges}
            <h1 style={{
                fontFamily: GH_SANS,
                fontSize: isNarrow ? 'clamp(32px, 9vw, 44px)' : 'clamp(48px, 6.5vw, 84px)',
                fontWeight: 600,
                lineHeight: isNarrow ? 1.05 : 0.92,
                letterSpacing: '-0.03em',
                margin: '0 0 16px',
                color: GH.ink,
            }}>
                {isNarrow ? fullName : <>{specialist.firstName}<br />{specialist.lastName}</>}
            </h1>
            {specialist.tagline && (
                <p style={{
                    fontFamily: GH_SANS,
                    fontSize: isNarrow ? 18 : 22,
                    fontWeight: 400,
                    lineHeight: 1.4,
                    color: GH.label,
                    maxWidth: 620,
                    margin: 0,
                }}>
                    {specialist.tagline}
                </p>
            )}
            {isNarrow && (
                <p className="num" style={{ margin: '12px 0 0', fontSize: 16, fontWeight: 600, color: GH.ink }}>
                    {[price !== null && formatGel(price), `${duration} мин`, formatLabel].filter(Boolean).join(' · ')}
                </p>
            )}
            {contacts}
        </header>
    );

    const photo = (
        <figure style={{
            margin: 0,
            border: `1px solid ${GH.ink}`,
            padding: isNarrow ? 6 : 10,
            background: GH.paper,
            maxWidth: isNarrow ? 420 : 'none',
        }}>
            <div style={{
                aspectRatio: '4 / 5',
                maxHeight: isNarrow ? '55vh' : undefined,
                width: '100%',
                background: GH.ink5,
                overflow: 'hidden',
                position: 'relative',
            }}>
                {specialist.photoUrl ? (
                    <img
                        src={specialist.photoUrl}
                        alt={fullName}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                ) : (
                    <div aria-hidden="true" style={{
                        width: '100%',
                        height: '100%',
                        minHeight: 200,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: GH_SANS,
                        fontSize: 72,
                        fontWeight: 600,
                        color: GH.ink60,
                    }}>
                        {`${specialist.firstName?.[0] ?? ''}${specialist.lastName?.[0] ?? ''}`.toUpperCase()}
                    </div>
                )}
            </div>
            <figcaption style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: `1px solid ${GH.ink10}`,
                display: 'flex',
                justifyContent: 'flex-end',
                ...monoLabel,
            }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Check size={14} aria-hidden="true" /> Проверен Unbox
                </span>
            </figcaption>
        </figure>
    );

    // G2-24: на узком экране — строками «метка слева, значение справа»
    // (три ячейки в две колонки разваливались).
    const formatRows: { label: string; value: ReactNode }[] = [
        { label: 'Формат', value: formatLabel || '—' },
        {
            label: 'Где',
            value: selectedCenters.length > 0 ? (
                selectedCenters.map((loc, i) => (
                    <span key={loc.id}>
                        <Link
                            to={toCatalog(`/location/${loc.id}`)}
                            style={{ color: GH.ink, textDecoration: 'underline', textUnderlineOffset: 2 }}
                        >
                            {loc.label}
                        </Link>
                        {i < selectedCenters.length - 1 ? ', ' : ''}
                    </span>
                ))
            ) : hasAnyOffline ? 'Батуми' : hasOnline ? 'Онлайн' : '—',
        },
        { label: 'Длительность', value: `${duration} минут` },
    ];
    const formatStrip = isNarrow ? (
        <dl style={{ margin: '0 0 48px', borderTop: `1px solid ${GH.ink}` }}>
            {formatRows.map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, padding: '12px 0', borderBottom: `1px solid ${GH.ink10}` }}>
                    <dt style={monoLabel}>{r.label}</dt>
                    <dd style={{ margin: 0, fontSize: 16, fontWeight: 500, textAlign: 'right' }}>{r.value}</dd>
                </div>
            ))}
        </dl>
    ) : (
        <dl style={{
            margin: '0 0 72px',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            borderTop: `1px solid ${GH.ink}`,
            borderBottom: `1px solid ${GH.ink10}`,
        }}>
            {formatRows.map((r, i) => (
                <div key={r.label} style={{ padding: i === 0 ? '18px 16px 18px 0' : i === formatRows.length - 1 ? '18px 0 18px 16px' : '18px 16px', borderRight: i < formatRows.length - 1 ? `1px solid ${GH.ink10}` : undefined }}>
                    <dt style={monoLabel}>{r.label}</dt>
                    <dd style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 500 }}>{r.value}</dd>
                </div>
            ))}
        </dl>
    );

    const practiceSection = practice.length > 0 && (
        <section style={{ marginBottom: isNarrow ? 48 : 72 }}>
            <div style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                borderBottom: `1px solid ${GH.ink}`,
                paddingBottom: 14,
                marginBottom: 8,
                gap: 16,
                flexWrap: 'wrap',
            }}>
                <h2 style={sectionHead}>Практика</h2>
                <div style={monoLabel}>{ruCountWord(practice.length, ['направление', 'направления', 'направлений'])}</div>
            </div>
            <ul style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                gridTemplateColumns: isNarrow ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                columnGap: 32,
            }}>
                {practice.map(spec => (
                    <li key={spec} style={{ padding: '14px 0', borderBottom: `1px solid ${GH.ink10}`, fontSize: 16, fontWeight: 500, lineHeight: 1.4 }}>
                        {spec}
                    </li>
                ))}
            </ul>
        </section>
    );

    const aboutSection = (
        <section>
            <div style={{
                borderBottom: `1px solid ${GH.ink}`,
                paddingBottom: 14,
                marginBottom: 28,
            }}>
                <h2 style={sectionHead}>О себе</h2>
            </div>
            <div style={{ fontFamily: GH_SANS, fontSize: 17, lineHeight: 1.7, color: GH.ink, maxWidth: 640 }}>
                {specialist.bio
                    ? <StructuredText text={specialist.bio} />
                    : 'Специалист пока не добавил описание о себе.'}
            </div>
        </section>
    );

    return (
        <div style={pageStyle}>
            {/* G2-03: у публичной версии — общая шапка сайта (в /m её рисует оболочка). */}
            <PublicHeader />
            <div style={{ maxWidth: 1280, margin: '0 auto', padding: pagePad }}>

                {/* Top bar: назад в каталог (в /m — в мобильный каталог). */}
                <div style={{
                    borderBottom: `1px solid ${GH.ink10}`,
                    padding: '4px 0',
                    marginBottom: isNarrow ? 24 : 48,
                }}>
                    {backLink}
                </div>

                {isNarrow ? (
                    <>
                        {nameHeader}
                        <div style={{ marginBottom: 32 }}>{photo}</div>
                        {formatStrip}
                        {practiceSection}
                        {aboutSection}
                    </>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 4fr) minmax(0, 8fr)',
                        gap: 56,
                        alignItems: 'start',
                    }}>
                        {/* LEFT: Sticky index card */}
                        <aside style={{ position: 'sticky', top: 88, width: '100%' }}>
                            {photo}

                            {/* Price block */}
                            {price !== null && (
                                <div style={{
                                    borderLeft: `1px solid ${GH.ink}`,
                                    borderRight: `1px solid ${GH.ink}`,
                                    borderBottom: `1px solid ${GH.ink}`,
                                    padding: 20,
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    justifyContent: 'space-between',
                                    gap: 12,
                                }}>
                                    <div>
                                        <div style={monoLabel}>Сессия</div>
                                        <div className="num" style={{ fontSize: 40, fontWeight: 600, lineHeight: 1, marginTop: 6, letterSpacing: '-0.03em' }}>
                                            {formatGel(price)}
                                        </div>
                                    </div>
                                    <div style={{ ...monoLabel, textAlign: 'right' }}>
                                        {duration} мин
                                    </div>
                                </div>
                            )}

                            {/* CTA — прокрутка к записи ниже на странице (#specialist-slots). */}
                            <Button variant="primary" size="touch" block onClick={scrollToSlots} style={{ marginTop: 16 }}>
                                Записаться{price !== null ? ` · ${formatGel(price)}` : ''}
                            </Button>
                        </aside>

                        {/* RIGHT: Content */}
                        <div>
                            {nameHeader}
                            {formatStrip}
                            {practiceSection}
                            {aboutSection}
                        </div>
                    </div>
                )}

                {/* Запись. id — цель кнопок «Записаться». */}
                <div id="specialist-slots" style={{ marginTop: isNarrow ? 48 : 104, scrollMarginTop: inShell ? 16 : 80 }}>
                    <SpecialistBookingChessboardGrid
                        specialistId={specialist.id}
                        specialistName={fullName}
                        formats={specialist.formats}
                        basePriceGel={specialist.basePriceGel}
                    />
                </div>
            </div>

            {/* G2-03 / G4-24: на телефоне — липкая «Записаться» над нижним меню
                (в /m) или у края экрана, с учётом safe-area. */}
            {isNarrow && !slotsInView && (
                <div style={{
                    position: 'fixed',
                    left: 0,
                    right: 0,
                    bottom: inShell ? 'calc(72px + env(safe-area-inset-bottom, 0px))' : 0,
                    padding: inShell ? '8px 16px' : '8px 16px calc(8px + env(safe-area-inset-bottom, 0px))',
                    background: GH.paper,
                    borderTop: `1px solid ${GH.ink10}`,
                    zIndex: Z.sticky,
                }}>
                    <Button variant="primary" size="touch" block onClick={scrollToSlots}>
                        Записаться{price !== null ? ` · ${formatGel(price)}` : ''}
                    </Button>
                </div>
            )}
        </div>
    );
}
