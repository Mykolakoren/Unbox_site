export type Format = 'individual' | 'group';

export interface Location {
    id: string;
    name: string;
    address: string;
}

export interface Resource {
    id: string;
    name: string;
    type: 'cabinet' | 'capsule';
    locationId: string;
}

export interface TimeSlot {
    start: Date;
    end: Date;
}

export interface BookingState {
    step: number;
    locationId: string | null;
    resourceId: string | null;
    format: Format;
    date: Date;
    startTime: string | null; // HH:mm
    duration: number; // minutes
    extras: string[]; // ids of selected extras
}

export interface ExtraOption {
    id: string;
    name: string;
    price: number;
}

export interface PricingResult {
    basePrice: number;
    extrasPrice: number;
    discountAmount: number;
    discountType: 'none' | 'duration' | 'hot' | 'loyalty';
    finalPrice: number;
}

export const EXTRAS: ExtraOption[] = [
    { id: 'sandbox', name: 'Песочница', price: 0 }, // Specific price not mentioned, assuming part of setup or need clarification. 
    // Wait, prompt says: "Каждая опция: имеет стоимость". I will assign indicative prices or 0 if unknown. 
    // The prompt lists: Sandbox, Toys for sandbox, Flipchart, Projector.
    // I will assign placeholders and update if needed.
    { id: 'sandbox_toys', name: 'Игрушки для песочной терапии', price: 10 },
    { id: 'flipchart', name: 'Флипчарт', price: 10 },
    { id: 'projector', name: 'Проектор', price: 20 },
];
// Prompt says: "Песочница" AND "Игрушки". I'll add Sandbox price too.
// Let's set Sandbox to 15.
