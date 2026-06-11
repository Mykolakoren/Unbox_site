import axios from 'axios';
import { toast } from 'sonner';
import { apiErrorMessage } from '../utils/errors';

// API URL:
// In development, use VITE_API_URL or fallback to relative path (proxied by Vite)
// In production (DigitalOcean), relative path '/api/v1' is proxied by nginx to backend
export const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    // 30s было мало для мобильной сети (5G/3G дрожит) — фоновые fetch'и
    // регулярно отваливались с ECONNABORTED и валили красный toast в UI.
    // 60s даёт запас на одно повторное подключение TCP без видимой ошибки.
    timeout: 60000,
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

// Per-message dedup — без него 3 параллельных fetch'а с 502 кидали 3
// одинаковых тоста подряд. Запоминаем последний показанный текст и душим
// повтор в течение dedupWindowMs.
const TOAST_DEDUP_WINDOW_MS = 4000;
let _lastErrorToastAt = 0;
let _lastErrorToastText = '';
const showErrorToastOnce = (text: string, opts?: any) => {
    const now = Date.now();
    if (text === _lastErrorToastText && now - _lastErrorToastAt < TOAST_DEDUP_WINDOW_MS) {
        return;
    }
    _lastErrorToastText = text;
    _lastErrorToastAt = now;
    toast.error(text, opts);
};

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
        // GET = чтение данных. Если 5xx/timeout — это фоновое обновление,
        // юзеру об этом знать не нужно (старые данные на экране остаются,
        // следующий refresh обычно проходит). Кидаем ошибку только для
        // write-методов (POST/PUT/PATCH/DELETE), где юзер ждёт результат
        // конкретного действия.
        const method = (error.config?.method || 'get').toLowerCase();
        const isReadOnly = method === 'get' || method === 'head' || method === 'options';

        // Clear invalid/expired token and redirect to login
        if (status === 401 || (status === 403 && detail === 'Could not validate credentials')) {
            localStorage.removeItem('token');
            window.location.href = '/login';
            return Promise.reject(error);
        }

        if (status && status >= 500) {
            if (!isReadOnly) showErrorToastOnce('Ошибка сервера. Попробуйте позже.');
        } else if (status === 422 && detail) {
            // Use shared helper so we never end up trying to render an
            // {message, conflicts} object as a React child (Minified
            // React error #31).
            showErrorToastOnce(apiErrorMessage(error, 'Ошибка валидации данных'));
        } else if (status === 409 && detail) {
            showErrorToastOnce(apiErrorMessage(error, 'Конфликт данных'), { duration: 8000 });
        } else if (!error.response && error.code === 'ECONNABORTED') {
            // Timeout — пробрасываем юзеру только если это write. Для GET
            // тихо роняем, кэш на странице остаётся на месте.
            if (!isReadOnly) showErrorToastOnce('Превышено время ожидания. Проверьте соединение.');
        } else if (!error.response && error.message === 'Network Error') {
            // Network errors могут быть «вы перешли в туннель / на лифте» —
            // тоже мешают на каждом фоновом fetch'е. Показываем только
            // на write-запросах.
            if (!isReadOnly) showErrorToastOnce('Нет соединения с сервером.');
        }

        return Promise.reject(error);
    }
);
