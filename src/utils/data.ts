import type { Location, Resource, ExtraOption } from '../types';

export const LOCATIONS: Location[] = [
    { id: 'unbox_one', name: 'Unbox One', address: 'Палиашвили, 4' },
    { id: 'unbox_uni', name: 'Unbox Uni', address: 'Тбел Абусеридзе, 38' },
    { id: 'neo_school', name: 'Neo School', address: 'Алесандра Сулаберидзе, 80' },
];

export const RESOURCES: Resource[] = [
    // Unbox One
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
        description: 'Компактный кабинет для индивидуальной, детской и семейной терапии.'
    },
    {
        id: 'unbox_one_room_2',
        name: 'Кабинет 2',
        type: 'cabinet',
        hourlyRate: 20,
        capacity: 10,
        locationId: 'unbox_one',
        area: 12,
        minBookingHours: 1,
        formats: ['individual', 'group'],
        description: 'Универсальный кабинет для индивидуальной работы, семейных консультаций и малых групп.'
    },
    // Unbox Uni
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
        description: 'Кабинет для индивидуальной, детской и семейной терапии.'
    },
    {
        id: 'unbox_uni_room_6',
        name: 'Кабинет 6',
        type: 'cabinet',
        hourlyRate: 20,
        capacity: 10,
        locationId: 'unbox_uni',
        area: 16,
        minBookingHours: 1,
        formats: ['individual', 'group'],
        description: 'Кабинет подходит для индивидуальной и групповой работы, а также для работы с детьми и семейных консультаций.'
    },
    {
        id: 'unbox_uni_room_7',
        name: 'Кабинет 7',
        type: 'cabinet',
        hourlyRate: 20,
        capacity: 20,
        locationId: 'unbox_uni',
        area: 25,
        minBookingHours: 1,
        formats: ['individual', 'group'],
        description: 'Большой кабинет для групповых встреч, тренингов, лекций и мероприятий.'
    },
    {
        id: 'unbox_uni_room_8',
        name: 'Кабинет 8',
        type: 'cabinet',
        hourlyRate: 20,
        capacity: 20,
        locationId: 'unbox_uni',
        area: 20,
        minBookingHours: 1,
        formats: ['individual', 'group'],
        description: 'Просторный кабинет для групповой и индивидуальной работы.'
    },
    {
        id: 'unbox_uni_room_9',
        name: 'Кабинет 9',
        type: 'cabinet',
        hourlyRate: 20,
        capacity: 10,
        locationId: 'unbox_uni',
        area: 16,
        minBookingHours: 1,
        formats: ['individual', 'group'],
        description: 'Уютный кабинет для индивидуальной и групповой работы.'
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
        description: 'Индивидуальная капсула для онлайн-сессий и сосредоточенной работы.'
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
        description: 'Индивидуальная капсула для онлайн-сессий и сосредоточенной работы.'
    },
];

export const EXTRAS: ExtraOption[] = [
    { id: 'sandbox', name: 'Песочница', price: 15 },
    { id: 'sandbox_toys', name: 'Игрушки для песочной терапии', price: 10 },
    { id: 'flipchart', name: 'Флипчарт', price: 10 },
    { id: 'projector', name: 'Проектор', price: 20 },
];

export const SUBSCRIPTION_PLANS = [
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
        formats: ['individual', 'group'],
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
