// apps/desktop/src/store/settingsStore.ts
import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';

interface SettingsStore {
  onboardingComplete: boolean;
  loaded: boolean;

  loadSettings: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

async function getStore() {
  return load('settings.json', { defaults: {}, autoSave: true });
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  onboardingComplete: false,
  loaded: false,

  loadSettings: async () => {
    const store = await getStore();
    const onboardingComplete = (await store.get<boolean>('onboardingComplete')) ?? false;
    set({ onboardingComplete, loaded: true });
  },

  completeOnboarding: async () => {
    const store = await getStore();
    await store.set('onboardingComplete', true);
    set({ onboardingComplete: true });
  },
}));
