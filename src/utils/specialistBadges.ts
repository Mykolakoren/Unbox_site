// Плашки-маркеры на карточке специалиста. Фиксированный набор — ставит
// только админ (backend ALLOWED_BADGES = in_training | recommended).
// Единый источник для карточки, профиля и админки. 2026-07-03 owner.

export interface BadgeDef {
    code: string;
    label: string;
    /** цвет текста / рамки */
    fg: string;
    /** фон плашки */
    bg: string;
    border: string;
}

export const SPECIALIST_BADGES: BadgeDef[] = [
    {
        code: 'recommended',
        label: 'Рекомендованный специалист',
        fg: '#065F46',
        bg: '#D1FAE5',
        border: '#6EE7B7',
    },
    {
        code: 'in_training',
        label: 'Специалист в обучении',
        fg: '#92400E',
        bg: '#FEF3C7',
        border: '#FCD34D',
    },
];

export const getBadge = (code: string): BadgeDef | undefined =>
    SPECIALIST_BADGES.find(b => b.code === code);
