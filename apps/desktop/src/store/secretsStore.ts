// apps/desktop/src/store/secretsStore.ts
import { create } from 'zustand';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir, join } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';

const CLIENT_NAME = 'poietai';
const TOKEN_KEY = 'gh_token';

async function getInstallKey(): Promise<string> {
  const dir = await appDataDir();
  const keyPath = await join(dir, 'install.key');
  if (await exists(keyPath)) {
    return readTextFile(keyPath);
  }
  const key = crypto.randomUUID();
  await writeTextFile(keyPath, key);
  return key;
}

async function openVault() {
  const dir = await appDataDir();
  const vaultPath = await join(dir, 'vault.hold');
  const password = await getInstallKey();
  const stronghold = await Stronghold.load(vaultPath, password);

  // loadClient throws if the client doesn't exist yet (fresh install).
  let client;
  try {
    client = await stronghold.loadClient(CLIENT_NAME);
  } catch {
    client = await stronghold.createClient(CLIENT_NAME);
    await stronghold.save();
  }

  return { stronghold, client };
}

interface SecretsStore {
  ghToken: string | null;
  loaded: boolean;
  isLoading: boolean;
  error: string | null;

  loadToken: () => Promise<void>;
  saveToken: (token: string) => Promise<void>;
}

export const useSecretsStore = create<SecretsStore>((set, get) => ({
  ghToken: null,
  loaded: false,
  isLoading: false,
  error: null,

  loadToken: async () => {
    // Guard against concurrent calls (React StrictMode double-invoke).
    if (get().loaded || get().isLoading) return;
    set({ isLoading: true });
    try {
      const { client } = await openVault();
      const store = client.getStore();
      const raw = await store.get(TOKEN_KEY);
      if (raw) {
        const token = new TextDecoder().decode(raw);
        set({ ghToken: token, loaded: true, isLoading: false });
      } else {
        set({ loaded: true, isLoading: false });
      }
    } catch (e) {
      console.warn('Stronghold unavailable — GH token not loaded:', e);
      set({ loaded: true, isLoading: false });
    }
  },

  saveToken: async (token: string) => {
    try {
      const { stronghold, client } = await openVault();
      const store = client.getStore();
      const encoded = Array.from(new TextEncoder().encode(token));
      // Remove the existing key before inserting to avoid duplicate-key errors.
      try { await store.remove(TOKEN_KEY); } catch { /* key may not exist yet */ }
      await store.insert(TOKEN_KEY, encoded);
      await stronghold.save();
      set({ ghToken: token, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Failed to save GH token:', e);
      set({ error: msg });
      throw e;
    }
  },
}));
