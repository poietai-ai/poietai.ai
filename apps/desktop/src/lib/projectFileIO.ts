import { invoke } from '@tauri-apps/api/core';

export async function readProjectStore<T>(projectRoot: string, filename: string): Promise<T | null> {
  const raw = await invoke<string | null>('read_project_store', {
    projectRoot,
    filename,
  });
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

export async function writeProjectStore(projectRoot: string, filename: string, data: unknown): Promise<void> {
  await invoke('write_project_store', {
    projectRoot,
    filename,
    data: JSON.stringify(data),
  });
}
