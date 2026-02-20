// apps/desktop/src/components/agents/CreateAgentModal.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../../store/agentStore';

const ROLES = [
  'fullstack-engineer',
  'backend-engineer',
  'frontend-engineer',
  'devops',
] as const;

const PERSONALITIES = [
  'pragmatic',
  'meticulous',
  'creative',
  'systematic',
] as const;

interface Props {
  onClose: () => void;
}

export function CreateAgentModal({ onClose }: Props) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>(ROLES[0]);
  const [personality, setPersonality] = useState<string>(PERSONALITIES[0]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useAgentStore();

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const id = crypto.randomUUID();
      await invoke('create_agent', { id, name: name.trim(), role, personality });
      await refresh();
      onClose();
    } catch (e) {
      console.error('failed to create agent:', e);
      setError('Failed to create agent. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-5 w-80 shadow-2xl">
        <h2 className="text-neutral-100 font-semibold mb-4">New agent</h2>

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
                     focus:border-indigo-500 mb-3"
        />

        <label htmlFor="agent-role" className="block text-neutral-400 text-xs mb-1">Role</label>
        <select
          id="agent-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white mb-3 focus:outline-none focus:border-indigo-500"
        >
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        <label htmlFor="agent-personality" className="block text-neutral-400 text-xs mb-1">Personality</label>
        <select
          id="agent-personality"
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white mb-4 focus:outline-none focus:border-indigo-500"
        >
          {PERSONALITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm text-neutral-400 hover:text-neutral-200 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                       text-white px-4 py-1.5 rounded-lg transition-colors"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
