import axios from 'axios';

// API URL:
// In development, use VITE_API_URL or fallback to relative path (proxied by Vite)
// In production (DigitalOcean), relative path '/api/v1' is proxied by nginx to backend
export const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

import { toCamelCase, toSnakeCase } from '../utils/transformers';

// Request interceptor to add Auth Token & Transform Request
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    // Transform request data to snake_case for backend
    if (config.data && !(config.data instanceof FormData)) {
        config.data = toSnakeCase(config.data);
    }

    return config;
});

// Response interceptor: Transform Response & Handle 401/403
api.interceptors.response.use(
    (response) => {
        // Transform response data to camelCase for frontend
        if (response.data) {
            response.data = toCamelCase(response.data);
        }
        return response;
    },
    (error) => {
        const status = error.response?.status;
        const detail = error.response?.data?.detail;
        // Clear invalid/expired token and redirect to login
        if (status === 401 || (status === 403 && detail === 'Could not validate credentials')) {
            localStorage.removeItem('token');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);
