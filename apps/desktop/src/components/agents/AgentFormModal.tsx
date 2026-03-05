import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore, type Agent } from '../../store/agentStore';

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

const INITIATIVE_OPTIONS = [
  { value: '', label: 'Follow personality default' },
  { value: 'auto', label: 'Auto-start' },
  { value: 'ask', label: 'Ask first' },
  { value: 'suggest', label: 'Suggest only' },
  { value: 'off', label: 'Off' },
] as const;

interface Props {
  onClose: () => void;
  /** When set, modal is in edit mode — pre-fills fields and shows Save + Delete. */
  agent?: Agent;
}

export function AgentFormModal({ onClose, agent }: Props) {
  const isEdit = !!agent;
  const [name, setName] = useState(agent?.name ?? '');
  const [role, setRole] = useState<string>(agent?.role ?? ROLES[0]);
  const [personality, setPersonality] = useState<string>(agent?.personality ?? PERSONALITIES[0]);
  const [initiative, setInitiative] = useState<string>(agent?.initiative ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { refresh, persistAgents, updateAgent, deleteAgent } = useAgentStore();

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isEdit) {
        await updateAgent(agent.id, {
          name: name.trim(),
          role,
          personality,
          initiative: initiative || null,
        });
      } else {
        const id = crypto.randomUUID();
        await invoke('create_agent', { id, name: name.trim(), role, personality, chatSessionId: null, initiative: initiative || null });
        await refresh();
        await persistAgents();
      }
      onClose();
    } catch (e) {
      console.error('failed to save agent:', e);
      setError(isEdit ? 'Failed to update agent.' : 'Failed to create agent.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!agent) return;
    setSaving(true);
    try {
      await deleteAgent(agent.id);
      onClose();
    } catch (e) {
      console.error('failed to delete agent:', e);
      setError('Failed to delete agent.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-5 w-80 shadow-2xl">
        <h2 className="text-neutral-100 font-semibold mb-4">
          {isEdit ? 'Edit agent' : 'New agent'}
        </h2>

        <label htmlFor="agent-name" className="block text-neutral-400 text-xs mb-1">Name</label>
        <input
          id="agent-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !saving && handleSubmit()}
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
                     text-sm text-white mb-3 focus:outline-none focus:border-indigo-500"
        >
          {PERSONALITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <label htmlFor="agent-initiative" className="block text-neutral-400 text-xs mb-1">Initiative</label>
        <select
          id="agent-initiative"
          value={initiative}
          onChange={(e) => setInitiative(e.target.value)}
          className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white mb-4 focus:outline-none focus:border-indigo-500"
        >
          {INITIATIVE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>

        {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

        {/* Delete confirmation */}
        {isEdit && confirmDelete && (
          <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-3 mb-3">
            <p className="text-red-300 text-xs mb-2">Delete this agent? Message history will be preserved.</p>
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={saving}
                className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? 'Deleting...' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-neutral-400 hover:text-neutral-200 px-3 py-1"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          {isEdit && !confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Delete agent
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-sm text-neutral-400 hover:text-neutral-200 px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || !name.trim()}
              className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                         text-white px-4 py-1.5 rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
