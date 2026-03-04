// apps/desktop/src/store/settingsStore.ts
import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';

/** Categories that map to one or more canvas node types */
export const NODE_CATEGORIES = {
  thoughts: ['thought'],
  messages: ['agent_message'],
  tools: ['file_read', 'file_edit', 'file_write', 'bash_command'],
  status: ['status_update'],
  plan: ['plan_task'],
} as const;

export type NodeCategory = keyof typeof NODE_CATEGORIES;

interface SettingsStore {
  onboardingComplete: boolean;
  hiddenNodeCategories: Set<NodeCategory>;
  loaded: boolean;

  loadSettings: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  toggleNodeCategory: (category: NodeCategory) => void;
}

async function getStore() {
  return load('settings.json', { defaults: {}, autoSave: true });
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  onboardingComplete: false,
  hiddenNodeCategories: new Set(),
  loaded: false,

  loadSettings: async () => {
    if (get().loaded) return;
    const store = await getStore();
    const onboardingComplete = (await store.get<boolean>('onboardingComplete')) ?? false;
    const hiddenArr = (await store.get<string[]>('hiddenNodeCategories')) ?? [];
    const hiddenNodeCategories = new Set(hiddenArr as NodeCategory[]);
    set({ onboardingComplete, hiddenNodeCategories, loaded: true });
  },

  completeOnboarding: async () => {
    try {
      const store = await getStore();
      await store.set('onboardingComplete', true);
    } catch (e) {
      console.warn('failed to persist onboardingComplete:', e);
    }
    set({ onboardingComplete: true });
  },

  toggleNodeCategory: (category: NodeCategory) => {
    const next = new Set(get().hiddenNodeCategories);
    if (next.has(category)) {
      next.delete(category);
    } else {
      next.add(category);
    }
    set({ hiddenNodeCategories: next });
    // Persist asynchronously
    getStore()
      .then((store) => store.set('hiddenNodeCategories', [...next]))
      .catch((e) => console.warn('failed to persist hiddenNodeCategories:', e));
  },
}));
