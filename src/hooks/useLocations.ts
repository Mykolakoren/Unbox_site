import { useQuery } from '@tanstack/react-query';
import { locationsApi } from '../api/locations';
import { useBookingStore } from '../store/bookingStore';
import { useEffect } from 'react';

export function useLocations() {
    const query = useQuery({
        queryKey: ['locations'],
        queryFn: locationsApi.getLocations,
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
