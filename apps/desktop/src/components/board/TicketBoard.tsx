import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useTicketStore, type Ticket, type TicketStatus } from '../../store/ticketStore';
import { TicketCard } from './TicketCard';
import { useNavigationStore } from '../../store/navigationStore';
import { notifyAgentOfMove } from '../../lib/agentMoveDm';

const COLUMNS: { id: TicketStatus; label: string }[] = [
  { id: 'backlog',     label: 'Backlog'     },
  { id: 'refined',    label: 'Refined'     },
  { id: 'assigned',   label: 'Assigned'    },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review',  label: 'In Review'   },
  { id: 'shipped',    label: 'Shipped'     },
];

function DroppableColumn({
  colId,
  label,
  children,
}: {
  colId: TicketStatus;
  label: string;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: colId });
  const ticketCount = Array.isArray(children) ? children.length : children ? 1 : 0;

  return (
    <div ref={setNodeRef} className="flex-shrink-0 w-56">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-neutral-400 text-xs font-semibold uppercase tracking-wider">
          {label}
        </h3>
        {ticketCount > 0 && (
          <span className="text-neutral-600 text-xs">{ticketCount}</span>
        )}
      </div>
      <div
        className={`space-y-2 min-h-[48px] rounded-lg p-1 transition-colors ${
          isOver ? 'bg-zinc-800/50' : ''
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function TicketBoard() {
  const { tickets, updateTicketStatus } = useTicketStore();
  const setSelectedTicketId = useNavigationStore((s) => s.setSelectedTicketId);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    const ticket = event.active.data.current?.ticket as Ticket | undefined;
    setActiveTicket(ticket ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTicket(null);
    const { active, over } = event;
    if (!over) return;

    const ticketId = active.id as string;
    const newStatus = over.id as TicketStatus;
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket || ticket.status === newStatus) return;

    const oldStatus = updateTicketStatus(ticketId, newStatus);
    if (oldStatus) {
      notifyAgentOfMove(ticket, oldStatus, newStatus);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 p-4 h-full overflow-x-auto">
        {COLUMNS.map((col) => {
          const colTickets = tickets.filter((t) => t.status === col.id);
          return (
            <DroppableColumn key={col.id} colId={col.id} label={col.label}>
              {colTickets.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  onOpenCanvas={setSelectedTicketId}
                />
              ))}
            </DroppableColumn>
          );
        })}
      </div>

      <DragOverlay>
        {activeTicket && (
          <div className="bg-zinc-800 border border-violet-500 rounded-lg p-3 w-56 shadow-2xl opacity-90">
            <p className="text-zinc-100 text-sm font-medium leading-snug">
              {activeTicket.title}
            </p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
