import axios from 'axios';

// Backend on Render.com
const PROD_API_URL = 'https://unbox-site.onrender.com/api/v1';

// In production (Vercel), point to Render backend
// In development, use VITE_API_URL or fallback to localhost
export const API_URL = import.meta.env.PROD
    ? PROD_API_URL
    : (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api/v1');

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

// Response interceptor: Transform Response & Handle 401
api.interceptors.response.use(
    (response) => {
        // Transform response data to camelCase for frontend
        if (response.data) {
            response.data = toCamelCase(response.data);
        }
        return response;
    },
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            // Optionally redirect
        }
        return Promise.reject(error);
    }
);
