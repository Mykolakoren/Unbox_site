import { api as client } from './client';

export interface TimelineEvent {
    id: string;
    event_type: string;
    actor_id: string;
    actor_req_role: string;
    target_id: string;
    target_type: string;
    description: string;
    metadata_dump: Record<string, any>;
    timestamp: string;
}

export const fetchTimelineEvents = async (params: {
    target_id?: string;
    event_type?: string;
    limit?: number
} = {}) => {
    const response = await client.get<TimelineEvent[]>('/timeline/', { params });
    return response.data;
};
