import type { StateCreator } from 'zustand';
import type { UserStore, AuthSlice } from '../types';
import { authApi } from '../../api/auth';

export const createAuthSlice: StateCreator<UserStore, [], [], AuthSlice> = (set) => ({
    currentUser: null,

    login: async (email, password) => {
        try {
            if (!password) {
                console.warn("Legacy login without password used. Cannot authenticate against backend.");
                return;
            }
            const { accessToken } = await authApi.login({ email, password });
            localStorage.setItem('token', accessToken);

            // Fetch full user profile
            const user = await authApi.getMe();
            set({ currentUser: user });
        } catch (error) {
            console.error("Login failed:", error);
            throw error; // Re-throw for UI to handle
        }
    },

    googleLogin: async (token) => {
        try {
            const { accessToken } = await authApi.googleLogin(token);
            localStorage.setItem('token', accessToken);
            const user = await authApi.getMe();
            set({ currentUser: user });
        } catch (error) {
            console.error("Google Login failed:", error);
            throw error;
        }
    },

    telegramLogin: async (data) => {
        try {
            const { accessToken } = await authApi.telegramLogin(data);
            localStorage.setItem('token', accessToken);
            const user = await authApi.getMe();
            set({ currentUser: user });
        } catch (error) {
            console.error("Telegram Login failed:", error);
            throw error;
        }
    },

    fetchCurrentUser: async () => {
        try {
            const user = await authApi.getMe();
            set({ currentUser: user });
        } catch (error) {
            console.error("Failed to fetch current user", error);
            // Optionally logout if token is invalid
            // localStorage.removeItem('token');
            // set({ currentUser: null });
        }
    },

    logout: () => {
        localStorage.removeItem('token');
        set({ currentUser: null });
    },

    register: async (userData) => {
        try {
            if (!userData.password) {
                throw new Error("Password required for registration");
            }
            // Register returns the created user, but we usually want to login immediately or wait for email
            await authApi.register({ ...userData, password: userData.password });

            // Auto-login after register
            const { accessToken } = await authApi.login({
                email: userData.email!,
                password: userData.password
            });
            localStorage.setItem('token', accessToken);
            const user = await authApi.getMe();
            set({ currentUser: user });

        } catch (error) {
            console.error("Registration failed:", error);
            throw error;
        }
    },
});
