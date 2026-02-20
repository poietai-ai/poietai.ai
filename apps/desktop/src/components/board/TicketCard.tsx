import { invoke } from '@tauri-apps/api/core';
import { useTicketStore, type Ticket } from '../../store/ticketStore';
import { useCanvasStore } from '../../store/canvasStore';
import { buildPrompt } from '../../lib/promptBuilder';

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

  const handleAssign = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const agentId = 'agent-1';

    assignTicket(ticket.id, agentId);

    const systemPrompt = buildPrompt({
      role: 'fullstack-engineer',
      personality: 'pragmatic',
      projectName: 'poietai.ai',
      projectStack: 'Rust, React 19, Tauri 2, TypeScript',
      projectContext: '',
      ticketNumber: parseInt(ticket.id.replace('ticket-', ''), 10),
      ticketTitle: ticket.title,
      ticketDescription: ticket.description,
      ticketAcceptanceCriteria: ticket.acceptanceCriteria,
    });

    try {
      await invoke('start_agent', {
        payload: {
          agent_id: agentId,
          ticket_id: ticket.id,
          ticket_slug: ticket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
          prompt: `${ticket.title}\n\n${ticket.description}`,
          system_prompt: systemPrompt,
          repo_root: '/home/keenan/github/poietai.ai',
          gh_token: '',
          resume_session_id: null,
        },
      });
      updateTicketStatus(ticket.id, 'in_progress');
      setActiveTicket(ticket.id);
      onOpenCanvas(ticket.id);
    } catch (err) {
      console.error('failed to start agent:', err);
    }
  };

  return (
    <div
      className="bg-neutral-800 border border-neutral-700 rounded-lg p-3
                 hover:border-neutral-600 transition-colors cursor-pointer group"
      onClick={() => onOpenCanvas(ticket.id)}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-neutral-100 text-sm leading-snug">{ticket.title}</p>
        <span className={`text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${complexityClass(ticket.complexity)}`}>
          {ticket.complexity}
        </span>
      </div>

      {ticket.assignedAgentId ? (
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-indigo-700 text-xs text-white
                          flex items-center justify-center">
            A
          </div>
          <span className="text-neutral-500 text-xs truncate">{ticket.assignedAgentId}</span>
        </div>
      ) : (
        <button
          onClick={handleAssign}
          className="text-xs text-indigo-400 hover:text-indigo-300 opacity-0
                     group-hover:opacity-100 transition-opacity"
        >
          + Assign agent
        </button>
      )}
    </div>
  );
}
