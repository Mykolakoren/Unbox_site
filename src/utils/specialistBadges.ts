import { themed } from '../design/tokens';
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
        fg: themed('#065F46', '#7DD69A'),
        bg: themed('#D1FAE5', '#16291D'),
        border: themed('#6EE7B7', '#2C5A3B'),
    },
    {
        code: 'in_training',
        label: 'Специалист в обучении',
        fg: themed('#92400E', '#E8B955'),
        bg: themed('#FEF3C7', '#2E2410'),
        border: themed('#FCD34D', '#5A4516'),
    },
];

export const getBadge = (code: string): BadgeDef | undefined =>
    SPECIALIST_BADGES.find(b => b.code === code);
