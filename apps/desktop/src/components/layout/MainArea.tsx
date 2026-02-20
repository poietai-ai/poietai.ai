import { TicketCanvas } from '../canvas/TicketCanvas';

interface MainAreaProps {
  activeView: string;
}

const viewLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  rooms: 'Rooms',
  board: 'Board',
  graph: 'Graph',
  messages: 'Messages',
};

export function MainArea({ activeView }: MainAreaProps) {
  // The graph view fills the full area — no header
  if (activeView === 'graph') {
    return (
      <main className="flex-1 overflow-hidden">
        <TicketCanvas ticketId="ticket-1" />
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col bg-neutral-900 overflow-hidden">
      <header className="px-6 py-4 border-b border-neutral-800">
        <h1 className="text-neutral-100 text-lg font-semibold">
          {viewLabels[activeView] ?? activeView}
        </h1>
      </header>
      <div className="flex-1 flex items-center justify-center text-neutral-600">
        <p>{viewLabels[activeView]} — coming soon</p>
      </div>
    </main>
  );
}
