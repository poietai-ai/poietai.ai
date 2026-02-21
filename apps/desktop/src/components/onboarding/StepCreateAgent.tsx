// apps/desktop/src/components/onboarding/StepCreateAgent.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../../store/agentStore';

const ROLES = [
  { value: 'fullstack-engineer', label: 'Full-stack engineer', description: 'Works across frontend and backend' },
  { value: 'backend-engineer',   label: 'Backend engineer',   description: 'APIs, databases, services' },
  { value: 'frontend-engineer',  label: 'Frontend engineer',  description: 'UI, components, styling' },
  { value: 'devops',             label: 'DevOps',             description: 'CI/CD, infra, deployment' },
] as const;

const PERSONALITIES = [
  { value: 'pragmatic',   label: 'Pragmatic',   description: 'Gets things done, minimal ceremony' },
  { value: 'meticulous',  label: 'Meticulous',  description: 'Thorough, careful, well-documented' },
  { value: 'creative',    label: 'Creative',    description: 'Novel approaches, thinks outside the box' },
  { value: 'systematic',  label: 'Systematic',  description: 'Structured, consistent, follows patterns' },
] as const;

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

export function StepCreateAgent({ onComplete, onSkip }: Props) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>(ROLES[0].value);
  const [personality, setPersonality] = useState<string>(PERSONALITIES[0].value);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh, persistAgents } = useAgentStore();

  const handleCreate = async () => {
    if (!name.trim()) return;
    setError(null);
    setCreating(true);
    try {
      await invoke('create_agent', {
        id: crypto.randomUUID(),
        name: name.trim(),
        role,
        personality,
      });
      await refresh();
      await persistAgents();
      onComplete();
    } catch (e) {
      console.error('failed to create agent:', e);
      setError('Failed to create agent. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-lg w-full">
      <h2 className="text-neutral-100 text-xl font-semibold mb-2">Create your first agent</h2>
      <p className="text-neutral-400 text-sm mb-6 leading-relaxed">
        Agents are AI workers that read your tickets, write code, and open pull requests.
        Give yours a name, a role, and a personality.
      </p>

      <label htmlFor="agent-name" className="block text-neutral-400 text-xs mb-1">Name</label>
      <input
        id="agent-name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !creating && handleCreate()}
        placeholder="e.g. Atlas"
        className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                   text-sm text-white placeholder-neutral-500 focus:outline-none
                   focus:border-indigo-500 mb-4"
      />

      <p className="text-neutral-400 text-xs mb-2">Role</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {ROLES.map((r) => (
          <button
            type="button"
            key={r.value}
            onClick={() => setRole(r.value)}
            className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
              role === r.value
                ? 'border-indigo-500 bg-indigo-950 text-indigo-200'
                : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-neutral-600'
            }`}
          >
            <p className="font-medium text-xs">{r.label}</p>
            <p className="text-neutral-500 text-xs mt-0.5">{r.description}</p>
          </button>
        ))}
      </div>

      <p className="text-neutral-400 text-xs mb-2">Personality</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {PERSONALITIES.map((p) => (
          <button
            type="button"
            key={p.value}
            onClick={() => setPersonality(p.value)}
            className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
              personality === p.value
                ? 'border-indigo-500 bg-indigo-950 text-indigo-200'
                : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-neutral-600'
            }`}
          >
            <p className="font-medium text-xs">{p.label}</p>
            <p className="text-neutral-500 text-xs mt-0.5">{p.description}</p>
          </button>
        ))}
      </div>

      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

      <div className="flex gap-2 justify-between mt-2">
        <button onClick={onSkip} className="text-sm text-neutral-500 hover:text-neutral-300">
          Skip for now
        </button>
        <button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                     text-white px-6 py-2 rounded-lg transition-colors"
        >
          {creating ? 'Creating…' : "Let's go →"}
        </button>
      </div>
    </div>
  );
}
