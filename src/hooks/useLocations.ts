import { useQuery } from '@tanstack/react-query';
import { locationsApi } from '../api/locations';
import { useBookingStore } from '../store/bookingStore';
import { useEffect } from 'react';

// Desired display order: Unbox One → Unbox Uni → Neo School.
// 2026-05-06: One ставим первым — это «первый» центр (открыт раньше),
// логика «1 = One, 2 = Uni» совпадает с названиями.
const LOCATION_ORDER: Record<string, number> = {
    unbox_one: 0,
    unbox_uni: 1,
    neo_school: 2,
};

export function useLocations() {
    const query = useQuery({
        queryKey: ['locations'],
        queryFn: async () => {
            const data = await locationsApi.getLocations();
            return [...data].sort(
                (a, b) =>
                    (LOCATION_ORDER[a.id] ?? 99) - (LOCATION_ORDER[b.id] ?? 99)
            );
        },
    });

    // Keep Zustand store in sync for backward compatibility
    // if other components still rely on bookingStore.locations
    useEffect(() => {
        if (query.data) {
            useBookingStore.setState({ locations: query.data });
        }
    }, [query.data]);

    return query;
}
