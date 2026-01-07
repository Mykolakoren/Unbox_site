export interface ExternalEvent {
    id: string;
    resourceId: string;
    start: string; // ISO string
    end: string; // ISO string
    title: string;
    source: 'google_calendar';
}

// Initial mock data: Simulating that "Tomorrow" at 14:00-16:00 is busy
const getTomorrowAt = (hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
};

let mockEvents: ExternalEvent[] = [
    {
        id: 'gcal_1',
        resourceId: 'unbox_uni_room_5', // Was cabinet-5
        start: getTomorrowAt(14), // 14:00 tomorrow
        end: getTomorrowAt(16),   // 16:00 tomorrow
        title: 'Уборка',          // Cleaning
        source: 'google_calendar'
    },
    {
        id: 'gcal_2',
        resourceId: 'unbox_uni_capsule_1', // Was capsule-1
        start: getTomorrowAt(10),
        end: getTomorrowAt(12),
        title: 'Бронь по телефону', // Phone booking
        source: 'google_calendar'
    }
];

export const googleCalendarService = {
    getEvents: (resourceId: string): ExternalEvent[] => {
        return mockEvents.filter(e => e.resourceId === resourceId);
    },

    addEvent: (event: Omit<ExternalEvent, 'id' | 'source'>): Promise<void> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                const newEvent: ExternalEvent = {
                    ...event,
                    id: `gcal_${Date.now()}`,
                    source: 'google_calendar'
                };
                mockEvents.push(newEvent);
                console.log('Successfully synced to Google Calendar:', newEvent);
                resolve();
            }, 500);
        });
    }
};
