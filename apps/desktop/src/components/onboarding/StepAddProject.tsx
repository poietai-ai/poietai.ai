// apps/desktop/src/components/onboarding/StepAddProject.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useProjectStore, type Project, type Repo } from '../../store/projectStore';

interface RepoInfo {
  name: string;
  repo_root: string;
  remote_url?: string;
  provider?: string;
}

type ScanResult =
  | { type: 'single_repo'; name: string; repo_root: string; remote_url?: string; provider?: string }
  | { type: 'multi_repo'; repos: RepoInfo[]; suggested_name: string }
  | { type: 'no_repo' };

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

export function StepAddProject({ onNext, onSkip }: Props) {
  const { addProject } = useProjectStore();
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [projectName, setProjectName] = useState('');
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const handlePick = async () => {
    const selected = await open({ directory: true, multiple: false, title: 'Select project folder' });
    if (!selected) return;
    const result = await invoke<ScanResult>('scan_folder', { path: selected as string });
    setScanResult(result);
    if (result.type === 'single_repo') {
      setProjectName(result.name);
      setSelectedRepos(new Set([result.repo_root]));
    } else if (result.type === 'multi_repo') {
      setProjectName(result.suggested_name);
      setSelectedRepos(new Set(result.repos.map((r) => r.repo_root)));
    }
  };

  const toggleRepo = (repoRoot: string) => {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoRoot)) next.delete(repoRoot);
      else next.add(repoRoot);
      return next;
    });
  };

  const handleSave = async () => {
    if (!projectName.trim() || selectedRepos.size === 0) return;
    setSaving(true);

    let repos: Repo[] = [];
    if (scanResult?.type === 'single_repo') {
      repos = [{
        id: crypto.randomUUID(),
        name: scanResult.name,
        repoRoot: scanResult.repo_root,
        remoteUrl: scanResult.remote_url,
        provider: (scanResult.provider ?? 'github') as Repo['provider'],
      }];
    } else if (scanResult?.type === 'multi_repo') {
      repos = scanResult.repos
        .filter((r) => selectedRepos.has(r.repo_root))
        .map((r) => ({
          id: crypto.randomUUID(),
          name: r.name,
          repoRoot: r.repo_root,
          remoteUrl: r.remote_url,
          provider: (r.provider ?? 'github') as Repo['provider'],
        }));
    }

    const project: Project = { id: crypto.randomUUID(), name: projectName.trim(), repos };
    await addProject(project);
    setSaving(false);
    onNext();
  };

  return (
    <div className="max-w-lg w-full">
      <h2 className="text-neutral-100 text-xl font-semibold mb-2">Add a project</h2>
      <p className="text-neutral-400 text-sm mb-6 leading-relaxed">
        A project is a workspace — it can hold one repo or several (like a separate API and web frontend).
      </p>

      <button
        onClick={handlePick}
        className="w-full bg-neutral-800 border border-neutral-600 border-dashed rounded-lg
                   px-4 py-3 text-sm text-neutral-400 hover:text-neutral-200
                   hover:border-neutral-500 transition-colors text-left mb-4"
      >
        {scanResult ? '↺ Pick a different folder' : '+ Select project folder'}
      </button>

      {scanResult?.type === 'no_repo' && (
        <p className="text-red-400 text-xs mb-4">
          No Git repository found here. Pick a folder that contains a .git directory,
          or a parent folder with Git repos inside it.
        </p>
      )}

      {scanResult && scanResult.type !== 'no_repo' && (
        <>
          {scanResult.type === 'multi_repo' && (
            <div className="mb-4">
              <p className="text-neutral-400 text-xs mb-2">
                Found {scanResult.repos.length} repositories — select which to include:
              </p>
              {scanResult.repos.map((r) => (
                <label key={r.repo_root}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedRepos.has(r.repo_root)}
                    onChange={() => toggleRepo(r.repo_root)}
                    className="accent-indigo-500"
                  />
                  <div>
                    <p className="text-neutral-200 text-sm">{r.name}</p>
                    {r.remote_url && (
                      <p className="text-neutral-500 text-xs truncate">{r.remote_url}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {scanResult.type === 'single_repo' && scanResult.remote_url && (
            <p className="text-neutral-500 text-xs mb-4">{scanResult.remote_url}</p>
          )}

          <label htmlFor="project-name" className="block text-neutral-400 text-xs mb-1">
            Project name
          </label>
          <input
            id="project-name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                       text-sm text-white focus:outline-none focus:border-indigo-500 mb-4"
          />
        </>
      )}

      <div className="flex gap-2 justify-between mt-2">
        <button onClick={onSkip} className="text-sm text-neutral-500 hover:text-neutral-300">
          Skip for now
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !scanResult || scanResult.type === 'no_repo' || selectedRepos.size === 0 || !projectName.trim()}
          className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                     text-white px-6 py-2 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Next →'}
        </button>
      </div>
    </div>
  );
}
