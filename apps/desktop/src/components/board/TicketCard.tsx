// apps/desktop/src/components/board/TicketCard.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTicketStore, type Ticket } from '../../store/ticketStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useProjectStore } from '../../store/projectStore';
import { useSecretsStore } from '../../store/secretsStore';
import { AgentPickerModal } from '../agents/AgentPickerModal';
import { buildPrompt } from '../../lib/promptBuilder';
import type { Agent } from '../../store/agentStore';

interface TicketCardProps {
  ticket: Ticket;
  onOpenCanvas: (ticketId: string) => void;
}

function complexityClass(n: number): string {
  if (n <= 3) return 'text-green-400 bg-green-950';
  if (n <= 6) return 'text-yellow-400 bg-yellow-950';
  return 'text-red-400 bg-red-950';
}

export function TicketCard({ ticket, onOpenCanvas }: TicketCardProps) {
  const { assignTicket, updateTicketStatus } = useTicketStore();
  const { setActiveTicket } = useCanvasStore();
  const { projects, activeProjectId } = useProjectStore();
  const { ghToken } = useSecretsStore();
  const [showPicker, setShowPicker] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const handleAgentSelected = async (agent: Agent, repoId: string) => {
    setShowPicker(false);
    // Re-derive activeProject at call time to avoid stale closure if user switches projects.
    const project = useProjectStore.getState().projects.find(
      (p) => p.id === useProjectStore.getState().activeProjectId
    );
    if (!project) return;

    const repo = project.repos.find((r) => r.id === repoId) ?? project.repos[0];
    if (!repo) return;

    const systemPrompt = buildPrompt({
      agentId: agent.id,
      role: agent.role,
      personality: agent.personality,
      projectName: project.name,
      projectStack: 'Rust, React 19, Tauri 2, TypeScript',
      projectContext: '',
      ticketNumber: parseInt(ticket.id.replace('ticket-', ''), 10) || 0,
      ticketTitle: ticket.title,
      ticketDescription: ticket.description,
      ticketAcceptanceCriteria: ticket.acceptanceCriteria,
    });

    const ghToken = useSecretsStore.getState().ghToken ?? '';

    try {
      await invoke<void>('start_agent', {
        payload: {
          agent_id: agent.id,
          ticket_id: ticket.id,
          ticket_slug: ticket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
          prompt: `${ticket.title}\n\n${ticket.description}`,
          system_prompt: systemPrompt,
          repo_root: repo.repoRoot,
          gh_token: ghToken,
          resume_session_id: null,
        },
      });
      // Only mutate ticket state after the invoke succeeds — no rollback needed.
      assignTicket(ticket.id, { agentId: agent.id, repoId });
      updateTicketStatus(ticket.id, 'in_progress');
      setActiveTicket(ticket.id);
      onOpenCanvas(ticket.id);
    } catch (err) {
      console.error('failed to start agent:', err);
    }
  };

  return (
    <>
      {showPicker && (
        <AgentPickerModal
          onSelect={handleAgentSelected}
          onClose={() => setShowPicker(false)}
        />
      )}

      <div
        className="bg-zinc-800 border border-zinc-700 rounded-lg p-3
                   hover:border-zinc-600 transition-colors cursor-pointer group"
        onClick={() => onOpenCanvas(ticket.id)}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-zinc-100 text-sm font-medium leading-snug">{ticket.title}</p>
          <span
            className={`text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${complexityClass(ticket.complexity)}`}
          >
            {ticket.complexity}
          </span>
        </div>

        {ticket.assignments.length > 0 ? (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-violet-700 text-xs text-white
                            flex items-center justify-center">
              A
            </div>
            <span className="text-zinc-500 text-xs truncate">
              {ticket.assignments[0].agentId}
              {ticket.assignments.length > 1 && ` +${ticket.assignments.length - 1}`}
            </span>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setShowPicker(true); }}
            disabled={!activeProject || !ghToken}
            title={
              !activeProject ? 'Select a project first' :
              !ghToken ? 'Add a GitHub token in Settings first' :
              'Assign an agent'
            }
            className="text-xs text-violet-400 hover:text-violet-300 opacity-0
                       group-hover:opacity-100 transition-opacity
                       disabled:opacity-30 disabled:cursor-not-allowed"
          >
            + Assign agent
          </button>
        )}
      </div>
    </>
  );
}
