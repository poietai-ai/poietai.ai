// apps/desktop/src/components/agents/AgentPickerModal.tsx
import { useState } from 'react';
import { useAgentStore, type Agent } from '../../store/agentStore';
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
  if (agent.status === 'idle') return 'Idle';
  if (agent.status === 'working') return `Working on ${agent.current_ticket_id ?? 'a ticket'}`;
  return agent.status.replace(/_/g, ' ');
}

interface Props {
  onSelect: (agent: Agent) => void;
  onClose: () => void;
}

export function AgentPickerModal({ onSelect, onClose }: Props) {
  const { agents } = useAgentStore();
  const [showCreate, setShowCreate] = useState(false);

  if (showCreate) {
    return <CreateAgentModal onClose={() => setShowCreate(false)} />;
  }

  const idle = agents.filter((a) => a.status === 'idle');
  const busy = agents.filter((a) => a.status !== 'idle');

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 w-72 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-neutral-100 font-semibold text-sm">Assign agent</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 text-xl leading-none"
          >
            ×
          </button>
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
              <AgentRow key={agent.id} agent={agent} onSelect={onSelect} />
            ))}
          </div>
        )}

        {busy.length > 0 && (
          <div className="mb-2">
            <p className="text-neutral-600 text-xs mb-1 uppercase tracking-wide">
              Busy (will queue)
            </p>
            {busy.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={onSelect} />
            ))}
          </div>
        )}

        <button
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

function AgentRow({
  agent,
  onSelect,
}: {
  agent: Agent;
  onSelect: (a: Agent) => void;
}) {
  return (
    <button
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
