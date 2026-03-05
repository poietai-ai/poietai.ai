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
import { Plus } from 'lucide-react';
import { useTicketStore, type Ticket, type TicketStatus } from '../../store/ticketStore';
import { TicketCard } from './TicketCard';
import { TicketDetailPanel } from './TicketDetailPanel';
import { CreateTicketModal } from './CreateTicketModal';
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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [detailTicketId, setDetailTicketId] = useState<string | null>(null);

  const detailTicket = detailTicketId ? tickets.find((t) => t.id === detailTicketId) ?? null : null;

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
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex flex-col h-full">
          {/* Board header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="text-zinc-300 text-sm font-semibold uppercase tracking-wider">Board</h2>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/30 rounded-lg px-3 py-1.5 transition-colors"
            >
              <Plus size={14} /> New ticket
            </button>
          </div>

          {/* Columns */}
          <div className="flex gap-4 px-4 pb-4 flex-1 overflow-x-auto">
            {COLUMNS.map((col) => {
              const colTickets = tickets.filter((t) => t.status === col.id);
              return (
                <DroppableColumn key={col.id} colId={col.id} label={col.label}>
                  {colTickets.map((ticket) => (
                    <TicketCard
                      key={ticket.id}
                      ticket={ticket}
                      onOpenCanvas={setSelectedTicketId}
                      onOpenDetail={setDetailTicketId}
                    />
                  ))}
                </DroppableColumn>
              );
            })}
          </div>
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

      {showCreateModal && <CreateTicketModal onClose={() => setShowCreateModal(false)} />}

      {detailTicket && (
        <TicketDetailPanel
          ticket={detailTicket}
          onClose={() => setDetailTicketId(null)}
          onOpenCanvas={(ticketId) => { setDetailTicketId(null); setSelectedTicketId(ticketId); }}
        />
      )}
    </>
  );
}
