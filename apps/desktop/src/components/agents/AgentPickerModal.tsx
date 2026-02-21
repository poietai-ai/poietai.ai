// apps/desktop/src/components/agents/AgentPickerModal.tsx
import { useState } from 'react';
import { X, Circle, Loader2, MessageCircleQuestion, Eye, CircleAlert } from 'lucide-react';
import { useAgentStore, type Agent } from '../../store/agentStore';
import { useProjectStore } from '../../store/projectStore';
import { CreateAgentModal } from './CreateAgentModal';

function StatusIcon({ status }: { status: Agent['status'] }) {
  switch (status) {
    case 'idle':             return <Circle size={8} className="text-green-500 fill-green-500 flex-shrink-0" />;
    case 'working':          return <Loader2 size={12} className="text-violet-400 animate-spin flex-shrink-0" />;
    case 'waiting_for_user': return <MessageCircleQuestion size={12} className="text-amber-400 flex-shrink-0" />;
    case 'reviewing':        return <Eye size={12} className="text-blue-400 flex-shrink-0" />;
    case 'blocked':          return <CircleAlert size={12} className="text-red-500 flex-shrink-0" />;
    default:                 return <Circle size={8} className="text-zinc-500 fill-zinc-500 flex-shrink-0" />;
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

  if (activeProject && repos.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 w-72 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-zinc-100 font-semibold text-sm">Assign agent</h2>
            <button type="button" onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 transition-colors">
              <X size={16} />
            </button>
          </div>
          <p className="text-zinc-500 text-xs text-center py-4">
            This project has no repositories. Add one in Settings.
          </p>
        </div>
      </div>
    );
  }

  if (showCreate) {
    return <CreateAgentModal onClose={() => setShowCreate(false)} />;
  }

  if (pendingAgent && isMultiRepo) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 w-72 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-zinc-100 font-semibold text-sm">Which repo?</h2>
            <button type="button" onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 transition-colors">
              <X size={16} />
            </button>
          </div>
          <p className="text-zinc-500 text-xs mb-3">
            Assigning <span className="text-zinc-300">{pendingAgent.name}</span>
          </p>
          {repos.map((repo) => (
            <button
              type="button"
              key={repo.id}
              onClick={() => onSelect(pendingAgent, repo.id)}
              className="w-full flex flex-col items-start px-3 py-2 rounded-lg
                         hover:bg-zinc-800 transition-colors text-left mb-1"
            >
              <p className="text-zinc-200 text-sm">{repo.name}</p>
              {repo.remoteUrl && (
                <p className="text-zinc-500 text-xs truncate">{repo.remoteUrl}</p>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPendingAgent(null)}
            className="text-xs text-zinc-500 hover:text-zinc-300 mt-2"
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
      const repoId = repos[0]?.id ?? '';
      onSelect(agent, repoId);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 w-72 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-zinc-100 font-semibold text-sm">Assign agent</h2>
          <button type="button" onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {agents.length === 0 && (
          <p className="text-zinc-500 text-xs text-center py-4">
            No agents yet — create one below.
          </p>
        )}

        {idle.length > 0 && (
          <div className="mb-2">
            <p className="text-zinc-600 text-xs mb-1 uppercase tracking-wide">Available</p>
            {idle.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={handleAgentClick} />
            ))}
          </div>
        )}

        {busy.length > 0 && (
          <div className="mb-2">
            <p className="text-zinc-600 text-xs mb-1 uppercase tracking-wide">Busy (will queue)</p>
            {busy.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={handleAgentClick} />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-full mt-2 text-xs text-violet-400 hover:text-violet-300 py-2
                     border border-dashed border-zinc-700 rounded-lg transition-colors"
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
                 hover:bg-zinc-800 transition-colors text-left"
    >
      <StatusIcon status={agent.status} />
      <div className="min-w-0">
        <p className="text-zinc-200 text-sm">{agent.name}</p>
        <p className="text-zinc-500 text-xs truncate">{statusLabel(agent)}</p>
      </div>
    </button>
  );
}
