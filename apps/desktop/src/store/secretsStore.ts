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
  const client = await stronghold.loadClient(CLIENT_NAME);
  return { stronghold, client };
}

interface SecretsStore {
  ghToken: string | null;
  loaded: boolean;

  loadToken: () => Promise<void>;
  saveToken: (token: string) => Promise<void>;
}

export const useSecretsStore = create<SecretsStore>((set) => ({
  ghToken: null,
  loaded: false,

  loadToken: async () => {
    try {
      const { client } = await openVault();
      const store = client.getStore();
      const raw = await store.get(TOKEN_KEY);
      if (raw) {
        const token = new TextDecoder().decode(new Uint8Array(raw));
        set({ ghToken: token, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch (e) {
      console.warn('Stronghold unavailable — GH token not loaded:', e);
      set({ loaded: true });
    }
  },

  saveToken: async (token: string) => {
    const { stronghold, client } = await openVault();
    const store = client.getStore();
    const encoded = Array.from(new TextEncoder().encode(token));
    await store.insert(TOKEN_KEY, encoded);
    await stronghold.save();
    set({ ghToken: token });
  },
}));
