// apps/desktop/src/store/secretsStore.ts
import { create } from 'zustand';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir, join } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';

export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'azure';

const CLIENT_NAME = 'poietai';

function tokenKey(provider: GitProvider): string {
  return `token:${provider}`;
}

// Plaintext fallback path — used when Stronghold is unavailable (e.g. WSL2).
async function getFallbackPath(): Promise<string> {
  const dir = await appDataDir();
  return join(dir, 'tokens.json');
}

async function readFallbackTokens(): Promise<Partial<Record<GitProvider, string>>> {
  const path = await getFallbackPath();
  if (!(await exists(path))) return {};
  try {
    return JSON.parse(await readTextFile(path));
  } catch {
    return {};
  }
}

async function writeFallbackTokens(tokens: Partial<Record<GitProvider, string>>): Promise<void> {
  const path = await getFallbackPath();
  await writeTextFile(path, JSON.stringify(tokens, null, 2));
}

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
  ghToken: string | null;   // convenience alias for tokens['github']
  loaded: boolean;
  isLoading: boolean;
  usingFallback: boolean;   // true when Stronghold is unavailable

  loadToken: () => Promise<void>;
  saveToken: (token: string) => Promise<void>;
}

export const useSecretsStore = create<SecretsStore>((set, get) => ({
  ghToken: null,
  loaded: false,
  isLoading: false,
  usingFallback: false,

  loadToken: async () => {
    if (get().loaded || get().isLoading) return;
    set({ isLoading: true });

    // Try Stronghold first
    try {
      const { stronghold, client } = await openVault();
      const store = client.getStore();

      // Try new provider-keyed key first, then migrate from old gh_token key
      let raw = await store.get(tokenKey('github'));
      if (!raw) {
        raw = await store.get('gh_token'); // legacy migration
        if (raw) {
          // Migrate to new key
          const encoded = Array.from(new TextEncoder().encode(
            new TextDecoder().decode(raw)
          ));
          try { await store.remove('gh_token'); } catch { /* ignore */ }
          await store.insert(tokenKey('github'), encoded);
          await stronghold.save();
        }
      }

      if (raw) {
        const token = new TextDecoder().decode(raw);
        set({ ghToken: token, loaded: true, isLoading: false });
      } else {
        set({ loaded: true, isLoading: false });
      }
      return;
    } catch (e) {
      console.warn('Stronghold unavailable — trying plaintext fallback:', e);
    }

    // Plaintext fallback
    try {
      const tokens = await readFallbackTokens();
      const token = tokens['github'] ?? null;
      set({ ghToken: token, loaded: true, isLoading: false, usingFallback: true });
    } catch (e) {
      console.warn('Plaintext fallback also failed:', e);
      set({ loaded: true, isLoading: false, usingFallback: true });
    }
  },

  saveToken: async (token: string) => {
    // Try Stronghold first
    try {
      const { stronghold, client } = await openVault();
      const store = client.getStore();
      const encoded = Array.from(new TextEncoder().encode(token));
      try { await store.remove(tokenKey('github')); } catch { /* may not exist */ }
      await store.insert(tokenKey('github'), encoded);
      await stronghold.save();
      set({ ghToken: token, usingFallback: false });
      return;
    } catch (e) {
      console.warn('Stronghold save failed — using plaintext fallback:', e);
    }

    // Plaintext fallback
    const tokens = await readFallbackTokens();
    tokens['github'] = token;
    await writeFallbackTokens(tokens);
    set({ ghToken: token, usingFallback: true });
  },
}));
