// apps/desktop/src/components/layout/ProjectSwitcher.tsx
import { useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useProjectStore, type Project } from '../../store/projectStore';

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export function ProjectSwitcher() {
  const { projects, activeProjectId, loaded, loadFromDisk, addProject, switchProject } =
    useProjectStore();

  useEffect(() => {
    if (!loaded) loadFromDisk();
  }, [loaded, loadFromDisk]);

  const handleAdd = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select project folder',
    });
    if (!selected) return;
    const repoRoot = selected;
    const name = repoRoot.split('/').filter(Boolean).pop() ?? 'Project';
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      repos: [{
        id: crypto.randomUUID(),
        name,
        repoRoot,
        provider: 'github',
      }],
    };
    await addProject(project);
  };

  return (
    <div className="w-14 flex flex-col items-center py-3 gap-2 bg-neutral-950 border-r border-neutral-800">
      {projects.map((p) => (
        <button
          key={p.id}
          onClick={() => switchProject(p.id)}
          title={p.name}
          className={`w-9 h-9 rounded-xl text-xs font-bold transition-all ${
            p.id === activeProjectId
              ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 ring-offset-2 ring-offset-neutral-950'
              : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
          }`}
        >
          {initials(p.name)}
        </button>
      ))}
      <button
        onClick={handleAdd}
        title={loaded && projects.length === 0 ? 'Add your first project' : 'Add project'}
        className={`w-9 h-9 rounded-xl bg-neutral-800 text-neutral-400
                    hover:bg-neutral-700 hover:text-neutral-200 text-xl
                    flex items-center justify-center transition-colors
                    ${loaded && projects.length === 0
                      ? 'animate-pulse ring-2 ring-indigo-500 ring-offset-1 ring-offset-neutral-950'
                      : ''}`}
      >
        +
      </button>
    </div>
  );
}
