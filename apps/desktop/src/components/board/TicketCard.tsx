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
  const [showPicker, setShowPicker] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const handleAgentSelected = async (agent: Agent) => {
    setShowPicker(false);
    // Re-derive activeProject at call time to avoid stale closure if user switches projects.
    const project = useProjectStore.getState().projects.find(
      (p) => p.id === useProjectStore.getState().activeProjectId
    );
    if (!project) return;

    const systemPrompt = buildPrompt({
      role: agent.role,
      personality: agent.personality,
      projectName: project.name,
      // TODO: pull from project.stack once the field exists on the Project model
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
          // TODO(Task 9): use selected repo from AgentPickerModal instead of first repo
          repo_root: project.repos[0]?.repoRoot ?? '',
          gh_token: ghToken,
          resume_session_id: null,
        },
      });
      // Only mutate ticket state after the invoke succeeds — no rollback needed.
      assignTicket(ticket.id, { agentId: agent.id, repoId: '' }); // repoId wired in Task 9
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
        className="bg-neutral-800 border border-neutral-700 rounded-lg p-3
                   hover:border-neutral-600 transition-colors cursor-pointer group"
        onClick={() => onOpenCanvas(ticket.id)}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-neutral-100 text-sm leading-snug">{ticket.title}</p>
          <span
            className={`text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${complexityClass(ticket.complexity)}`}
          >
            {ticket.complexity}
          </span>
        </div>

        {ticket.assignments.length > 0 ? (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-indigo-700 text-xs text-white
                            flex items-center justify-center">
              A
            </div>
            <span className="text-neutral-500 text-xs truncate">
              {ticket.assignments[0].agentId}
              {ticket.assignments.length > 1 && ` +${ticket.assignments.length - 1}`}
            </span>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setShowPicker(true); }}
            disabled={!activeProject}
            title={activeProject ? 'Assign an agent' : 'Select a project first'}
            className="text-xs text-indigo-400 hover:text-indigo-300 opacity-0
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
