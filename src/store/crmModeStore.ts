import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CrmModeState {
    enabled: boolean;
    setEnabled: (v: boolean) => void;
    toggle: () => void;
}

export const useCrmModeStore = create<CrmModeState>()(
    persist(
        (set) => ({
            enabled: true,
            setEnabled: (enabled) => set({ enabled }),
            toggle: () => set((s) => ({ enabled: !s.enabled })),
        }),
        { name: 'unbox-crm-mode' }
    )
);
