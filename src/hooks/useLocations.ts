import { useQuery } from '@tanstack/react-query';
import { locationsApi } from '../api/locations';
import { useBookingStore } from '../store/bookingStore';
import { useEffect } from 'react';

// Desired display order: Unbox Uni → Unbox One → Neo School
const LOCATION_ORDER: Record<string, number> = {
    unbox_uni: 0,
    unbox_one: 1,
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
