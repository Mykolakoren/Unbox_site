import type { HTMLAttributes, MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

/**
 * ListGroup + ListRow (09.11) — ОДИН вид списка для всех экранов: брони
 * клиента, «Сегодня» CRM и админки, сессии, история клиента, должники,
 * клиенты, команда, строки шторок. Раньше та же строка была нарисована
 * пятью способами (отдельные карточки, цветные плитки, свои скругления).
 *
 * Группа — одна поверхность (card, рамка ink-10, радиус 16) с тонкими
 * линиями между строками и подписью сверху («СЕГОДНЯ», «НОЯБРЬ»).
 *
 *   <ListGroup title="Сегодня" aside={<Money value={dayTotal} />}>
 *     <ListRow
 *       lead={<ListTime start="10:00" end="11:00" />}
 *       title="Анна Ким"
 *       subtitle="Кабинет 5 · Uni · 1 ч"
 *       trail={<Money value={120} />}
 *       onClick={() => open(s)}
 *     />
 *     <ListRow
 *       lead={<ListAvatar name="Михаил Абашидзе" />}
 *       title="Михаил Абашидзе"
 *       subtitle="след.: ср, 11 нояб., 11:00"
 *       trail={<Money value={-120} tone="balance" />}
 *       to={`/m/crm/clients/${id}`}
 *     />
 *     <ListRow
 *       lead={<ListIcon><Wallet size={20} /></ListIcon>}
 *       title="Платёж"
 *       action={<Button size="sm" variant="secondary">Оплата · <Money value={120} inline /></Button>}
 *     />
 *   </ListGroup>
 *
 * Правила:
 *  - Название и подпись ПЕРЕНОСЯТСЯ, а не режутся многоточием; сумма справа
 *    не переносится и не режется никогда.
 *  - Справа — коротко: сумма, StatusBadge, «Абонемент». Длинное — в subtitle.
 *  - Вся строка нажимается (onClick → button, to → ссылка), стрелка «›» сама.
 *  - Своё действие в строке (action) — только Button size="sm" secondary/quiet
 *    или переключатель; оно стоит ВНЕ нажимаемой области (кнопка в кнопке нельзя).
 */

export interface ListGroupProps {
    /** Подпись над группой: день («Сегодня», «Пн, 16 ноября»), месяц, раздел. */
    title?: ReactNode;
    /** Справа от подписи: итог дня, счётчик, тихая ссылка. */
    aside?: ReactNode;
    /** Пояснение под группой (14, ink-60). */
    footer?: ReactNode;
    /** Внутри шторки/карточки — без своей поверхности и рамки. */
    bare?: boolean;
    /** Уровень заголовка подписи. По умолчанию h2. */
    titleAs?: 'h2' | 'h3' | 'div';
    'aria-label'?: string;
    className?: string;
    children: ReactNode;
}

export function ListGroup({
    title, aside, footer, bare = false, titleAs: TitleTag = 'h2', className, children, ...aria
}: ListGroupProps) {
    return (
        <section className={clsx('ui-list-group', className)} aria-label={aria['aria-label']}>
            {(title || aside) && (
                <div className="ui-list-group__head">
                    {title ? <TitleTag className="ui-list-group__title">{title}</TitleTag> : <span />}
                    {aside && <span className="ui-list-group__aside">{aside}</span>}
                </div>
            )}
            <ul className={clsx('ui-list', bare && 'ui-list--bare')}>{children}</ul>
            {footer && <p className="ui-list-group__foot">{footer}</p>}
        </section>
    );
}

/** Всё, что можно передать на нажимаемую часть строки: aria-* (aria-pressed,
 *  aria-current, aria-expanded…), data-*, обработчики (onContextMenu,
 *  onPointerDown, onTouchStart — свайп и долгое нажатие), id, title-подсказка. */
type RowPassThrough = Omit<HTMLAttributes<HTMLElement>, 'title' | 'className' | 'children' | 'onClick' | 'style'>
    & { [key: `data-${string}`]: string | number | boolean | undefined };

export interface ListRowProps extends RowPassThrough {
    /** Слева: <ListTime/>, <ListIcon/>, <ListAvatar/> или своё. */
    lead?: ReactNode;
    title: ReactNode;
    /** Вторая строка, 14 ink-60: «Кабинет 5 · Uni · 2 ч». */
    subtitle?: ReactNode;
    /** Третья строка — бейджи (StatusBadge) с переносом. */
    meta?: ReactNode;
    /** Справа: сумма (<Money/>), StatusBadge, короткое слово. */
    trail?: ReactNode;
    /** Под trail мелко (12 ink-60): «+5 ₾ доплата», «из абонемента». */
    trailSub?: ReactNode;
    /** Своё действие справа (Button size="sm" secondary/quiet, переключатель). */
    action?: ReactNode;
    onClick?: (e: MouseEvent<HTMLElement>) => void;
    /** Ссылка внутри приложения (react-router). */
    to?: string;
    /** Внешняя ссылка: tel:, mailto:, https://… (обычный <a>). */
    href?: string;
    /** Для href: '_blank' — новая вкладка (rel по умолчанию noopener noreferrer). */
    target?: string;
    rel?: string;
    /** Стрелка справа. По умолчанию — есть, если строка нажимается и action нет;
     *  у внешней ссылки (https, target=_blank) — «↗» вместо «›». */
    chevron?: boolean;
    disabled?: boolean;
    /** Прошедшее/неактивное: название и сумма ink-60 (не прозрачность — текст не бледнеет ниже 4.5:1). */
    dimmed?: boolean;
    /** Полоса слева: danger — «к оплате», pending — «ждёт». Только вместе со словом! */
    tone?: 'danger' | 'pending';
    /** Слово к полосе для диктора, если в строке его нет («к оплате»). */
    toneLabel?: string;
    /** li — строка внутри ListGroup (по умолчанию); div — внутри своей обёртки
     *  (например SwipeRow as="li", который сам стоит в списке). */
    as?: 'li' | 'div';
    className?: string;
}

export function ListRow({
    lead, title, subtitle, meta, trail, trailSub, action, onClick, to, href, target, rel, chevron,
    disabled = false, dimmed = false, tone, toneLabel, as: Root = 'li', className, ...pass
}: ListRowProps) {
    const interactive = !!(onClick || to || href) && !disabled;
    const external = !!href && (target === '_blank' || /^https?:/i.test(href));
    const showChevron = chevron ?? (interactive && !action);

    const content = (
        <>
            {lead}
            <span className="ui-row__body">
                <span className="ui-row__title">{title}</span>
                {subtitle && <span className="ui-row__subtitle">{subtitle}</span>}
                {meta && <span className="ui-row__meta">{meta}</span>}
                {tone && toneLabel && <span className="sr-only">{toneLabel}</span>}
            </span>
            {(trail || trailSub) && (
                <span className="ui-row__trail">
                    {trail && <span className="ui-row__trail-main">{trail}</span>}
                    {trailSub && <span className="ui-row__trail-sub">{trailSub}</span>}
                </span>
            )}
            {showChevron && (external
                ? <ArrowUpRight size={18} className="ui-row__chevron" aria-hidden="true" />
                : <ChevronRight size={18} className="ui-row__chevron" aria-hidden="true" />)}
        </>
    );

    let main: ReactNode;
    if (href && !disabled) {
        main = (
            <a href={href} target={target} rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
               className="ui-row__main" onClick={onClick} {...pass}>{content}</a>
        );
    } else if (to && !disabled) {
        main = <Link to={to} className="ui-row__main" onClick={onClick} {...pass}>{content}</Link>;
    } else if (onClick || ((to || href) && disabled)) {
        main = (
            <button type="button" className="ui-row__main" onClick={onClick} disabled={disabled} {...pass}>
                {content}
            </button>
        );
    } else {
        main = <div className="ui-row__main" {...pass}>{content}</div>;
    }

    return (
        <Root
            className={clsx(
                'ui-row',
                action && 'ui-row--with-action',
                dimmed && 'ui-row--dimmed',
                disabled && 'ui-row--disabled',
                className,
            )}
        >
            {tone && <span className={clsx('ui-row__stripe', `ui-row__stripe--${tone}`)} aria-hidden="true" />}
            {main}
            {action && <div className="ui-row__action">{action}</div>}
        </Root>
    );
}

/** Колонка времени фиксированной ширины 52 px: начало 16/600, конец 12 ink-60. */
export function ListTime({ start, end }: { start: ReactNode; end?: ReactNode }) {
    return (
        <span className="ui-row__time">
            <span className="ui-row__time-start num">{start}</span>
            {end && <span className="ui-row__time-end num">{end}</span>}
        </span>
    );
}

/** Значок 20 px ink-60 без цветной плитки-подложки. */
export function ListIcon({ children }: { children: ReactNode }) {
    return <span className="ui-row__icon" aria-hidden="true">{children}</span>;
}

/** Аватар 36 px: фото или инициалы на нейтральном sunken (не «нет данных», не красный). */
export function ListAvatar({ name, src }: { name: string; src?: string | null }) {
    const initials = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0]?.toUpperCase() ?? '')
        .join('');
    return (
        <span className="ui-row__avatar" aria-hidden="true">
            {src ? <img src={src} alt="" loading="lazy" /> : initials}
        </span>
    );
}
