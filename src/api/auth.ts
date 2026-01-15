import { api } from './client';
import type { User, Credentials } from '../store/types';

// Define types local to API if strictly needed, or import from shared types
// For now assuming we mirror the backend responses

interface AuthResponse {
    accessToken: string;
    tokenType: string;
}

export const authApi = {
    login: async (credentials: Credentials): Promise<AuthResponse> => {
        // OAuth2PasswordRequestForm expects form data
        const formData = new URLSearchParams();
        formData.append('username', credentials.email);
        if (!credentials.password) throw new Error("Password is required");
        formData.append('password', credentials.password);
        formData.append('grant_type', 'password'); // Required by FastAPI OAuth2

        const response = await api.post<AuthResponse>('/auth/login', formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return response.data;
    },

    register: async (userData: Partial<User> & { password: string }): Promise<User> => {
        const response = await api.post<User>('/auth/register', userData);
        return response.data;
    },

    getMe: async (): Promise<User> => {
        const response = await api.get<User>('/users/me');
        return response.data;
    },

    googleLogin: async (token: string): Promise<AuthResponse> => {
        const response = await api.post<AuthResponse>('/auth/google', { token });
        return response.data;
    },

    telegramLogin: async (data: any): Promise<AuthResponse> => {
        const response = await api.post<AuthResponse>('/auth/telegram', data);
        return response.data;
    }
};
