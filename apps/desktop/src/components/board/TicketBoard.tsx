import { useState } from 'react';
import { useTicketStore, type TicketStatus } from '../../store/ticketStore';
import { TicketCard } from './TicketCard';
import { TicketCanvas } from '../canvas/TicketCanvas';

const COLUMNS: { id: TicketStatus; label: string }[] = [
  { id: 'backlog',     label: 'Backlog'     },
  { id: 'refined',    label: 'Refined'     },
  { id: 'assigned',   label: 'Assigned'    },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review',  label: 'In Review'   },
  { id: 'shipped',    label: 'Shipped'     },
];

export function TicketBoard() {
  const { tickets } = useTicketStore();
  const [canvasTicketId, setCanvasTicketId] = useState<string | null>(null);

  // Drill into ticket canvas when a card is clicked or assigned
  if (canvasTicketId) {
    const ticket = tickets.find((t) => t.id === canvasTicketId);
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 flex-shrink-0">
          <button
            onClick={() => setCanvasTicketId(null)}
            className="text-neutral-400 hover:text-white text-sm transition-colors"
          >
            ← Board
          </button>
          {ticket && (
            <span className="text-neutral-500 text-sm truncate">{ticket.title}</span>
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          <TicketCanvas ticketId={canvasTicketId} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 p-4 h-full overflow-x-auto">
      {COLUMNS.map((col) => {
        const colTickets = tickets.filter((t) => t.status === col.id);
        return (
          <div key={col.id} className="flex-shrink-0 w-56">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-neutral-400 text-xs font-semibold uppercase tracking-wider">
                {col.label}
              </h3>
              {colTickets.length > 0 && (
                <span className="text-neutral-600 text-xs">{colTickets.length}</span>
              )}
            </div>
            <div className="space-y-2">
              {colTickets.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  onOpenCanvas={setCanvasTicketId}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
