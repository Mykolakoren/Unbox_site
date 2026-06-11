import type { Location, Resource, ExtraOption } from '../types';

export const LOCATIONS: Location[] = [
    // 2026-05-06: One ставим первым (логично — «One» = первый филиал, открыт раньше).
    { id: 'unbox_one', name: 'Unbox One', address: 'Палиашвили, 4' },
    { id: 'unbox_uni', name: 'Unbox Uni', address: 'Тбел Абусеридзе, 38' },
    { id: 'neo_school', name: 'Neo School', address: 'Алесандра Сулаберидзе, 80' },
];

export const RESOURCES: Resource[] = [
    // Unbox One (Палиашвили 4, Батуми)
    {
        id: 'unbox_one_room_1',
        name: 'Кабинет 1',
        type: 'cabinet',
        hourlyRate: 20,
        capacity: 4,
        locationId: 'unbox_one',
        area: 9,
        minBookingHours: 1,
        formats: ['individual'],
        description: 'Камерный кабинет 9 м² с профессиональной песочницей — для индивидуальной, детской и семейной терапии. Тёплое освещение, мягкий диван, полная звукоизоляция. Кондиционер, Wi-Fi, бесплатный чай и кофе.',
        photos: [
            '/img/cabinets/one/cab1/01.jpg',
            '/img/cabinets/one/cab1/02.jpg',
            '/img/cabinets/one/cab1/03.jpg',
            '/img/cabinets/one/cab1/04.jpg',
        ],
        services: ['sandbox', 'soundproof', 'climate_control', 'wifi'],
        sortOrder: 1,
    },
    {
        id: 'unbox_one_room_2',
        name: 'Кабинет 2',
        type: 'cabinet',
        hourlyRate: 20,
        capacity: 4,
        locationId: 'unbox_one',
        area: 12,
        minBookingHours: 1,
        formats: ['individual'],
        description: 'Просторный кабинет 12 м² в нейтральных тонах — спокойная атмосфера для индивидуальных сессий, парной и семейной терапии. Естественный свет, комфортный диван, звукоизоляция. Кондиционер, Wi-Fi, чай-кофе.',
        photos: [
            '/img/cabinets/one/cab2/01.jpg',
            '/img/cabinets/one/cab2/02.jpg',
            '/img/cabinets/one/cab2/03.jpg',
            '/img/cabinets/one/cab2/04.jpg',
            '/img/cabinets/one/cab2/05.jpg',
            '/img/cabinets/one/cab2/06.jpg',
        ],
        // 2026-06-02 owner: в Unbox One кушетку (extras +5 ₾) не предоставляем —
        // убрал из services чтобы availableExtrasForResource не показывал её.
        services: ['natural_light', 'soundproof', 'climate_control', 'wifi'],
        sortOrder: 2,
    },
    // Unbox Uni (Тбел Абусеридзе 38, Батуми)
    {
        id: 'unbox_uni_room_5',
        name: 'Кабинет 5',
        type: 'cabinet',
        hourlyRate: 20,
        capacity: 4,
        locationId: 'unbox_uni',
        area: 10,
        minBookingHours: 1,
        formats: ['individual'],
        description: 'Светлый кабинет 10 м² с большим окном — для индивидуальной, детской и семейной работы. Удобная мебель, мягкая цветовая гамма, кондиционер, Wi-Fi. Общая кухня с водой, чаем и кофе.',
        photos: [
            '/img/cabinets/uni/cab5/01.jpg',
            '/img/cabinets/uni/cab5/02.jpg',
            '/img/cabinets/uni/cab5/03.jpg',
        ],
        services: ['natural_light', 'couch', 'climate_control', 'wifi'],
        sortOrder: 3,
    },
    {
        id: 'unbox_uni_room_6',
        name: 'Кабинет 6',
        type: 'cabinet',
        hourlyRate: 20,
        capacity: 4,
        locationId: 'unbox_uni',
        area: 16,
        minBookingHours: 1,
        formats: ['individual'],
        // 2026-06-03 owner: убрали песочницу — Яна больше не предоставляет
        // игрушки другим специалистам.
        description: 'Просторный кабинет 16 м² — индивидуальная, детская и семейная терапия, работа с подростками. Естественный свет, диван, кондиционер, Wi-Fi.',
        photos: [
            '/img/cabinets/uni/cab6/01.jpg',
            '/img/cabinets/uni/cab6/02.jpg',
            '/img/cabinets/uni/cab6/03.jpg',
        ],
        services: ['natural_light', 'couch', 'climate_control', 'wifi'],
        sortOrder: 4,
    },
    {
        id: 'unbox_uni_room_7',
        name: 'Кабинет 7',
        type: 'cabinet',
        hourlyRate: 20,
        groupRate: 35,
        capacity: 20,
        locationId: 'unbox_uni',
        area: 25,
        minBookingHours: 1,
        formats: ['individual', 'group', 'intervision'],
        description: 'Самый большой зал — 25 м² на 20 человек — для тренингов, лекций, групповой терапии, интервизий и мероприятий. Флипчарт, проектор, маркерная доска, естественный свет, кондиционер, Wi-Fi.',
        photos: [
            '/img/cabinets/uni/cab7/01.jpg',
            '/img/cabinets/uni/cab7/02.jpg',
            '/img/cabinets/uni/cab7/03.jpg',
            '/img/cabinets/uni/cab7/04.jpg',
            '/img/cabinets/uni/cab7/05.jpg',
        ],
        services: ['flipchart', 'projector', 'whiteboard', 'couch', 'climate_control', 'wifi', 'natural_light'],
        sortOrder: 5,
    },
    {
        id: 'unbox_uni_room_8',
        name: 'Кабинет 8',
        type: 'cabinet',
        hourlyRate: 20,
        groupRate: 35,
        capacity: 20,
        locationId: 'unbox_uni',
        area: 20,
        minBookingHours: 1,
        formats: ['individual', 'group', 'intervision'],
        // 2026-06-03 owner: новое описание — пространство с приглушённым
        // дневным светом, подходит под презентации с проектором.
        description: 'Пространство 20 м² на 20 человек с приглушённым дневным светом — идеально для мероприятий с использованием проектора, групповой терапии и воркшопов. Флипчарт, маркерная доска, кондиционер, Wi-Fi.',
        photos: [
            '/img/cabinets/uni/cab8/01.jpg',
            '/img/cabinets/uni/cab8/02.jpg',
            '/img/cabinets/uni/cab8/03.jpg',
            '/img/cabinets/uni/cab8/04.jpg',
            '/img/cabinets/uni/cab8/05.jpg',
        ],
        services: ['flipchart', 'whiteboard', 'natural_light', 'couch', 'climate_control', 'wifi'],
        sortOrder: 6,
    },
    {
        id: 'unbox_uni_room_9',
        name: 'Кабинет 9',
        type: 'cabinet',
        hourlyRate: 20,
        groupRate: 35,
        capacity: 10,
        locationId: 'unbox_uni',
        area: 16,
        minBookingHours: 1,
        formats: ['individual', 'group', 'intervision'],
        description: 'Уютный кабинет 16 м² с отдельным входом — подходит и для индивидуальной, и для камерной групповой работы до 10 человек. Удобный диван, кондиционер, Wi-Fi.',
        services: ['private_entrance', 'couch', 'climate_control', 'wifi'],
        sortOrder: 7,
        // Сейчас кабинет не сдаётся — скрыт из выбора, но строка нужна
        // для рендера старых бронь по этому id. Включить обратно: убрать
        // эту строку или поставить `true`.
        isActive: false,
    },
    {
        id: 'unbox_uni_capsule_1',
        name: 'Капсула 1',
        type: 'capsule',
        hourlyRate: 10,
        capacity: 1,
        locationId: 'unbox_uni',
        area: 2,
        minBookingHours: 1,
        formats: ['individual'],
        description: 'Индивидуальная звукоизолированная капсула на одного — для онлайн-сессий, созвонов и сосредоточенной работы. Удобное кресло, монитор, Wi-Fi, кондиционер.',
        photos: [
            '/img/cabinets/uni/capsule/01.jpg',
            '/img/cabinets/uni/capsule/02.jpg',
            '/img/cabinets/uni/capsule/03.jpg',
        ],
        services: ['soundproof', 'wifi', 'climate_control'],
        sortOrder: 8,
    },
    {
        id: 'unbox_uni_capsule_2',
        name: 'Капсула 2',
        type: 'capsule',
        hourlyRate: 10,
        capacity: 1,
        locationId: 'unbox_uni',
        area: 2,
        minBookingHours: 1,
        formats: ['individual'],
        description: 'Индивидуальная звукоизолированная капсула на одного — для онлайн-сессий, созвонов и сосредоточенной работы. Удобное кресло, монитор, Wi-Fi, кондиционер.',
        photos: [
            '/img/cabinets/uni/capsule/01.jpg',
            '/img/cabinets/uni/capsule/02.jpg',
            '/img/cabinets/uni/capsule/03.jpg',
        ],
        services: ['soundproof', 'wifi', 'climate_control'],
        sortOrder: 9,
    },
];

// Cabinet/Room services with display metadata
export const CABINET_SERVICES: { id: string; label: string; emoji: string }[] = [
    { id: 'sandbox',         label: 'Песочница',           emoji: '🪣' },
    { id: 'natural_light',   label: 'Естественный свет',   emoji: '☀️' },
    { id: 'soundproof',      label: 'Звукоизоляция',       emoji: '🔇' },
    { id: 'couch',           label: 'Диван / Кушетка',     emoji: '🛋️' },
    { id: 'washbasin',       label: 'Умывальник',          emoji: '💧' },
    { id: 'private_entrance',label: 'Отдельный вход',      emoji: '🚪' },
    { id: 'coffee',          label: 'Кофемашина',          emoji: '☕' },
    { id: 'flipchart',       label: 'Флипчарт',            emoji: '📋' },
    { id: 'projector',       label: 'Проектор',            emoji: '📽️' },
    { id: 'whiteboard',      label: 'Маркерная доска',     emoji: '✏️' },
    { id: 'climate_control', label: 'Кондиционер',         emoji: '❄️' },
    { id: 'wifi',            label: 'Wi-Fi',               emoji: '📶' },
];

/** Extras — fallback, fetched from API at runtime.
 *
 * Prices updated 2026-05-06: bundled sandbox+toys at 5 GEL, projector & couch
 * each at 5 GEL, Meama coffee at 3 GEL. Old `sandbox_toys` id stays valid in
 * the backend registry so historical bookings render correctly, but it's
 * dropped from the public list — sandbox now ships with toys included.
 */
export let EXTRAS: ExtraOption[] = [
    { id: 'sandbox', name: 'Песочница с игрушками', price: 5 },
    { id: 'projector', name: 'Проектор', price: 5 },
    { id: 'couch', name: 'Кушетка', price: 5 },
    { id: 'coffee_meama', name: 'Кофе Меама', price: 3 },
    // 2026-06-02 owner: бесплатные опции для пред-заказа специалистом —
    // флипчарт и столик. Цена 0 ₾, но всё равно в extras чтобы попасть
    // в TG-уведомление и в чек-лист подготовки кабинета.
    { id: 'flipchart_free', name: 'Флипчарт', price: 0 },
    { id: 'table_free', name: 'Столик', price: 0 },
];

/** Filter EXTRAS list to those that make sense for the given resource.
 *
 *  Rules (owner 2026-05-29):
 *  - Capsule is a 2m² solo-online booth — only `coffee_meama` is offered;
 *    sandbox/projector/couch are physically impossible there.
 *  - For cabinets, an extra is offered only if the cabinet's `services`
 *    array advertises the same capability (e.g. sandbox → must have
 *    'sandbox' service). Coffee is offered everywhere.
 *  - Couch is treated as a per-resource feature too: only cabinets with
 *    a `couch` service can offer the extra (matches admin's intent —
 *    don't promise a couch in cabinets that don't have one).
 *
 *  If `resource` is null/undefined, returns the full list (defensive — we
 *  shouldn't filter blindly when we don't know what we're filtering for).
 */
export function availableExtrasForResource(
    resource: Resource | null | undefined,
): ExtraOption[] {
    if (!resource) return EXTRAS;
    const isCapsule = resource.type === 'capsule';
    return EXTRAS.filter(e => {
        if (isCapsule) return e.id === 'coffee_meama';
        if (e.id === 'sandbox') return resource.services?.includes('sandbox');
        if (e.id === 'projector') return resource.services?.includes('projector');
        if (e.id === 'couch') return resource.services?.includes('couch');
        // 2026-06-02: flipchart_free и table_free доступны во всех
        // кабинетах One и Uni (бесплатные опции для пред-заказа).
        // На капсуле уже отсечено выше.
        if (e.id === 'flipchart_free' || e.id === 'table_free') return true;
        return true;
    });
}

/** Subscription plans — fallback, fetched from API at runtime */
export let SUBSCRIPTION_PLANS = [
    {
        id: 'WARM_START',
        name: 'Тёплый старт',
        hours: 10,
        price: 180,
        durationDays: 30,
        discountPercent: 10,
        formats: ['individual']
    },
    {
        id: 'REGULAR_PRACTITIONER',
        name: 'Регулярный практик',
        hours: 20,
        price: 340,
        durationDays: 30,
        discountPercent: 15,
        formats: ['individual'],
        perks: ['1 бесплатный перенос']
    },
    {
        id: 'PRO_PLUS',
        name: 'Профи+',
        hours: 40,
        bonusHours: 2,
        price: 640,
        durationDays: 45,
        discountPercent: 20,
        formats: ['individual', 'group', 'intervision'],
        perks: ['Приоритет', 'Внеурочный доступ', 'Рекомендация']
    },
    {
        id: 'GROUP_MASTER',
        name: 'Групповой мастер',
        hours: 16,
        price: 420,
        durationDays: 30,
        discountPercent: 25,
        formats: ['group'],
        perks: ['Анонс по базе']
    },
];

// Note: previously this module fetched `/settings/extras` and
// `/settings/subscription_plans` from the backend on import to allow
// runtime overrides. Those endpoints were never implemented — every page
// load fired two 404s (~2300/h on prod) that polluted the access log and
// showed red errors in the user's console. The hardcoded EXTRAS and
// SUBSCRIPTION_PLANS above are the single source of truth; if we need
// dynamic plans later, add a real /settings endpoint and re-introduce a
// fetch helper that only runs after the response is verified.
