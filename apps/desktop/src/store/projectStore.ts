// apps/desktop/src/store/projectStore.ts
import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';

export interface Project {
  id: string;
  name: string;
  repoRoot: string;
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

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  loaded: false,

  loadFromDisk: async () => {
    const store = await getStore();
    const projects = (await store.get<Project[]>('projects')) ?? [];
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
