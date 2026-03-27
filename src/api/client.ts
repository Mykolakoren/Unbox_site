import axios from 'axios';
import { toast } from 'sonner';

// API URL:
// In development, use VITE_API_URL or fallback to relative path (proxied by Vite)
// In production (DigitalOcean), relative path '/api/v1' is proxied by nginx to backend
export const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 30000,
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

// Response interceptor: Transform Response & Handle errors
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
            return Promise.reject(error);
        }

        // Show toast for server errors (don't spam for 4xx which are handled by components)
        if (status && status >= 500) {
            toast.error('Ошибка сервера. Попробуйте позже.');
        } else if (!error.response && error.code === 'ECONNABORTED') {
            toast.error('Превышено время ожидания. Проверьте соединение.');
        } else if (!error.response && error.message === 'Network Error') {
            toast.error('Нет соединения с сервером.');
        }

        return Promise.reject(error);
    }
);
