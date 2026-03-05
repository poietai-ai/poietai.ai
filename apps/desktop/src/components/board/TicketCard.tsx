// apps/desktop/src/components/board/TicketCard.tsx
import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { invoke } from '@tauri-apps/api/core';
import { useTicketStore, type Ticket } from '../../store/ticketStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useProjectStore } from '../../store/projectStore';
import { useSecretsStore } from '../../store/secretsStore';
import { AgentPickerModal } from '../agents/AgentPickerModal';
import { TicketContextMenu } from './TicketContextMenu';
import { buildPrompt } from '../../lib/promptBuilder';
import { parsePlanArtifact } from '../../lib/parsePlanArtifact';
import type { Agent } from '../../store/agentStore';

interface TicketCardProps {
  ticket: Ticket;
  onOpenCanvas: (ticketId: string) => void;
  onOpenDetail: (ticketId: string) => void;
}

function complexityClass(n: number): string {
  if (n <= 3) return 'text-green-400 bg-green-950';
  if (n <= 6) return 'text-yellow-400 bg-yellow-950';
  return 'text-red-400 bg-red-950';
}

export function TicketCard({ ticket, onOpenCanvas, onOpenDetail }: TicketCardProps) {
  const { assignTicket, updateTicketStatus, resetTicket, deleteTicket } = useTicketStore();
  const { setActiveTicket } = useCanvasStore();
  const { projects, activeProjectId } = useProjectStore();
  const { ghToken } = useSecretsStore();
  const [showPicker, setShowPicker] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: ticket.id,
    data: { ticket },
  });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleAgentSelected = async (agent: Agent, repoId: string) => {
    setShowPicker(false);
    // Re-derive activeProject at call time to avoid stale closure if user switches projects.
    const project = useProjectStore.getState().projects.find(
      (p) => p.id === useProjectStore.getState().activeProjectId
    );
    if (!project) return;

    const repo = project.repos.find((r) => r.id === repoId) ?? project.repos[0];
    if (!repo) return;

    const planContent =
      ticket.activePhase === 'build' && ticket.artifacts.plan
        ? ticket.artifacts.plan.content
        : undefined;

    const systemPrompt = buildPrompt({
      agentId: agent.id,
      role: agent.role,
      personality: agent.personality,
      projectName: project.name,
      projectStack: 'Rust, React 19, Tauri 2, TypeScript',
      projectContext: '',
      ticketNumber: ticket.number,
      ticketTitle: ticket.title,
      ticketDescription: ticket.description,
      ticketAcceptanceCriteria: ticket.acceptanceCriteria,
      planContent,
      phase: ticket.activePhase,
    });

    const ghToken = useSecretsStore.getState().ghToken ?? '';

    // Set canvas context before starting so events are captured from the first tool call
    setActiveTicket(ticket.id);

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
          phase: ticket.activePhase ?? 'build',
        },
      });
      // Only mutate ticket state after the invoke succeeds — no rollback needed.
      assignTicket(ticket.id, { agentId: agent.id, repoId });
      updateTicketStatus(ticket.id, 'in_progress');
      // Seed ghost graph when entering BUILD phase with a plan artifact
      if (ticket.activePhase === 'build' && ticket.artifacts.plan) {
        const planArtifact = parsePlanArtifact(ticket.artifacts.plan.content);
        if (planArtifact) {
          useCanvasStore.getState().initGhostGraph(planArtifact);
        }
      }
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

      {contextMenu && (
        <TicketContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          actions={[
            { label: 'Reset ticket', onClick: () => resetTicket(ticket.id) },
            { label: 'Delete ticket', danger: true, onClick: () => deleteTicket(ticket.id) },
          ]}
        />
      )}

      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        style={style}
        className={`bg-zinc-800 border border-zinc-700 rounded-lg p-3
                   hover:border-zinc-600 transition-colors cursor-grab group
                   ${isDragging ? 'opacity-50' : ''}`}
        onClick={() => { if (!isDragging) onOpenDetail(ticket.id); }}
        onContextMenu={handleContextMenu}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-zinc-100 text-sm font-medium leading-snug">
            <span className="text-zinc-500 font-mono mr-1">#{ticket.number}</span>
            {ticket.title}
          </p>
          <span
            className={`text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${complexityClass(ticket.complexity)}`}
          >
            {ticket.complexity}
          </span>
        </div>

        {ticket.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {ticket.tags.map((tag) => (
              <span key={tag} className="text-[9px] bg-indigo-900/40 text-indigo-400 rounded px-1.5 py-0.5">
                {tag}
              </span>
            ))}
          </div>
        )}

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
