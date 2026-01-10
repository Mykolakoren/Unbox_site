import axios from 'axios';

// In production (Vercel), always use relative path to route via vercel.json rewrites
// In development, use VITE_API_URL or fallback to localhost
export const API_URL = import.meta.env.PROD
    ? '/api/v1'
    : (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api/v1');

export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor to add Auth Token
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Response interceptor to handle 401 (Auth Error)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            // Optionally redirect to login or clear store
            // window.location.href = '/login'; 
        }
        return Promise.reject(error);
    }
);
