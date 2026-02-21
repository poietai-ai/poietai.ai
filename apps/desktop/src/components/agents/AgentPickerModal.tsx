// apps/desktop/src/components/agents/AgentPickerModal.tsx
import { useState } from 'react';
import { useAgentStore, type Agent } from '../../store/agentStore';
import { useProjectStore } from '../../store/projectStore';
import { CreateAgentModal } from './CreateAgentModal';

function statusDot(status: Agent['status']): string {
  switch (status) {
    case 'idle': return 'bg-green-500';
    case 'working': return 'bg-orange-400';
    case 'waiting_for_user': return 'bg-amber-400';
    default: return 'bg-neutral-500';
  }
}

function statusLabel(agent: Agent): string {
  if (agent.status === 'idle') return 'Available';
  if (agent.status === 'working') return 'Busy (will queue)';
  return agent.status.replace(/_/g, ' ');
}

interface Props {
  onSelect: (agent: Agent, repoId: string) => void;
  onClose: () => void;
}

export function AgentPickerModal({ onSelect, onClose }: Props) {
  const { agents } = useAgentStore();
  const { projects, activeProjectId } = useProjectStore();
  const [showCreate, setShowCreate] = useState(false);
  const [pendingAgent, setPendingAgent] = useState<Agent | null>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const repos = activeProject?.repos ?? [];
  const isMultiRepo = repos.length > 1;

  if (showCreate) {
    return <CreateAgentModal onClose={() => setShowCreate(false)} />;
  }

  // Step 2: repo picker (only for multi-repo projects)
  if (pendingAgent && isMultiRepo) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 w-72 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-neutral-100 font-semibold text-sm">Which repo?</h2>
            <button onClick={onClose}
              className="text-neutral-500 hover:text-neutral-300 text-xl leading-none">×</button>
          </div>
          <p className="text-neutral-500 text-xs mb-3">
            Assigning <span className="text-neutral-300">{pendingAgent.name}</span>
          </p>
          {repos.map((repo) => (
            <button
              type="button"
              key={repo.id}
              onClick={() => onSelect(pendingAgent, repo.id)}
              className="w-full flex flex-col items-start px-3 py-2 rounded-lg
                         hover:bg-neutral-800 transition-colors text-left mb-1"
            >
              <p className="text-neutral-200 text-sm">{repo.name}</p>
              {repo.remoteUrl && (
                <p className="text-neutral-500 text-xs truncate">{repo.remoteUrl}</p>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPendingAgent(null)}
            className="text-xs text-neutral-500 hover:text-neutral-300 mt-2"
          >
            ← Back to agents
          </button>
        </div>
      </div>
    );
  }

  const idle = agents.filter((a) => a.status === 'idle');
  const busy = agents.filter((a) => a.status !== 'idle');

  const handleAgentClick = (agent: Agent) => {
    if (isMultiRepo) {
      setPendingAgent(agent);
    } else {
      // Single repo — use it directly
      const repoId = repos[0]?.id ?? '';
      onSelect(agent, repoId);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 w-72 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-neutral-100 font-semibold text-sm">Assign agent</h2>
          <button onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 text-xl leading-none">×</button>
        </div>

        {agents.length === 0 && (
          <p className="text-neutral-500 text-xs text-center py-4">
            No agents yet — create one below.
          </p>
        )}

        {idle.length > 0 && (
          <div className="mb-2">
            <p className="text-neutral-600 text-xs mb-1 uppercase tracking-wide">Available</p>
            {idle.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={handleAgentClick} />
            ))}
          </div>
        )}

        {busy.length > 0 && (
          <div className="mb-2">
            <p className="text-neutral-600 text-xs mb-1 uppercase tracking-wide">Busy (will queue)</p>
            {busy.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={handleAgentClick} />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-full mt-2 text-xs text-indigo-400 hover:text-indigo-300 py-2
                     border border-dashed border-neutral-700 rounded-lg transition-colors"
        >
          + New agent
        </button>
      </div>
    </div>
  );
}

function AgentRow({ agent, onSelect }: { agent: Agent; onSelect: (a: Agent) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(agent)}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg
                 hover:bg-neutral-800 transition-colors text-left"
    >
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(agent.status)}`} />
      <div className="min-w-0">
        <p className="text-neutral-200 text-sm">{agent.name}</p>
        <p className="text-neutral-500 text-xs truncate">{statusLabel(agent)}</p>
      </div>
    </button>
  );
}
