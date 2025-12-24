import type { Location, Resource, ExtraOption } from '../types';

export const LOCATIONS: Location[] = [
    { id: 'one', name: 'Unbox One', address: 'Палиашвили, 4' },
    { id: 'uni', name: 'Unbox Uni', address: 'Тбел Абусеридзе, 38' },
];

export const RESOURCES: Resource[] = [
    // Unbox One
    { id: 'cabinet_1', name: 'Кабинет 1', type: 'cabinet', locationId: 'one' },
    { id: 'cabinet_2', name: 'Кабинет 2', type: 'cabinet', locationId: 'one' },

    // Unbox Uni
    { id: 'capsule_1', name: 'Капсула 1', type: 'capsule', locationId: 'uni' },
    { id: 'capsule_2', name: 'Капсула 2', type: 'capsule', locationId: 'uni' },
    { id: 'cabinet_5', name: 'Кабинет 5', type: 'cabinet', locationId: 'uni' },
    { id: 'cabinet_6', name: 'Кабинет 6', type: 'cabinet', locationId: 'uni' },
    { id: 'cabinet_7', name: 'Кабинет 7', type: 'cabinet', locationId: 'uni' },
    { id: 'cabinet_8', name: 'Кабинет 8', type: 'cabinet', locationId: 'uni' },
    { id: 'cabinet_9', name: 'Кабинет 9', type: 'cabinet', locationId: 'uni' },
];

export const EXTRAS: ExtraOption[] = [
    { id: 'sandbox', name: 'Песочница', price: 15 },
    { id: 'sandbox_toys', name: 'Игрушки для песочной терапии', price: 10 },
    { id: 'flipchart', name: 'Флипчарт', price: 10 },
    { id: 'projector', name: 'Проектор', price: 20 },
];
