// apps/desktop/src/store/projectStore.ts
import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';
import type { GitProvider } from './secretsStore';

export interface Repo {
  id: string;
  name: string;
  repoRoot: string;
  remoteUrl?: string;
  provider: GitProvider;
}

export interface Project {
  id: string;
  name: string;
  repos: Repo[];
}

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;
  loaded: boolean;

  loadFromDisk: () => Promise<void>;
  addProject: (project: Project) => Promise<void>;
  switchProject: (id: string) => Promise<void>;
}

async function getStore() {
  return load('projects.json', { defaults: {}, autoSave: true });
}

// Migrate old project shape { repoRoot: string } → { repos: Repo[] }
function migrateProject(raw: Record<string, unknown>): Project {
  if (Array.isArray(raw.repos)) return raw as unknown as Project;
  // Legacy project had a single repoRoot string
  const repoRoot = raw.repoRoot as string ?? '';
  const name = raw.name as string ?? '';
  return {
    id: raw.id as string,
    name,
    repos: [{
      id: crypto.randomUUID(),
      name: repoRoot.split('/').filter(Boolean).pop() ?? name,
      repoRoot,
      provider: 'github',
    }],
  };
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  loaded: false,

  loadFromDisk: async () => {
    if (get().loaded) return;
    const store = await getStore();
    const raw = (await store.get<Record<string, unknown>[]>('projects')) ?? [];
    const projects = raw.map(migrateProject);
    const activeProjectId = (await store.get<string>('activeProjectId')) ?? null;
    set({ projects, activeProjectId, loaded: true });
  },

  addProject: async (project) => {
    const { projects } = get();
    const updated = [...projects, project];
    const store = await getStore();
    await store.set('projects', updated);
    await store.set('activeProjectId', project.id);
    set({ projects: updated, activeProjectId: project.id });
  },

  switchProject: async (id) => {
    const store = await getStore();
    await store.set('activeProjectId', id);
    set({ activeProjectId: id });
  },
}));
