import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useTicketStore } from '../../store/ticketStore';
import { useMessageStore } from '../../store/messageStore';
import { useNavigationStore } from '../../store/navigationStore';
import { useAgentStore } from '../../store/agentStore';

const styles = {
  mention: 'bg-violet-500/20 text-violet-300 cursor-pointer hover:bg-violet-500/30',
  ticket: 'bg-blue-500/20 text-blue-300 cursor-pointer hover:bg-blue-500/30',
  command: 'bg-amber-500/20 text-amber-300',
} as const;

interface TokenChipProps {
  tokenType: 'mention' | 'ticket' | 'command';
  raw: string;
  value: string;
}

export function TokenChip({ tokenType, raw, value }: TokenChipProps) {
  const base = `inline-flex items-center rounded-full px-1.5 text-[12px] font-medium mx-0.5 ${styles[tokenType]}`;

  if (tokenType === 'command') {
    return <span className={base}>{raw}</span>;
  }

  if (tokenType === 'mention') {
    const handleClick = () => {
      // Find agent by name
      const agents = useAgentStore.getState().agents;
      const agent = agents.find((a) => a.name === value);
      if (agent) {
        useNavigationStore.getState().setActiveView('messages');
        useMessageStore.getState().setActiveThread(agent.id);
      }
    };

    return (
      <span className={base} onClick={handleClick} role="button" tabIndex={0}>
        {raw}
      </span>
    );
  }

  // ticket
  const ticketNum = parseInt(value, 10);

  const handleClick = () => {
    const ticket = useTicketStore.getState().tickets.find((t) => t.number === ticketNum);
    if (ticket) {
      useNavigationStore.getState().setSelectedTicketId(ticket.id);
    }
  };

  return (
    <TicketChipWithTooltip num={ticketNum} className={base} onClick={handleClick}>
      {raw}
    </TicketChipWithTooltip>
  );
}

function TicketChipWithTooltip({
  num,
  className,
  onClick,
  children,
}: {
  num: number;
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const ticket = useTicketStore((s) => s.tickets.find((t) => t.number === num));

  if (!ticket) {
    return (
      <span className={className} onClick={onClick} role="button" tabIndex={0}>
        {children}
      </span>
    );
  }

  const statusColors: Record<string, string> = {
    backlog: 'bg-zinc-600',
    refined: 'bg-sky-600',
    assigned: 'bg-indigo-600',
    in_progress: 'bg-amber-600',
    in_review: 'bg-purple-600',
    shipped: 'bg-green-600',
    blocked: 'bg-red-600',
  };

  return (
    <Tooltip disableHoverableContent={false}>
      <TooltipTrigger asChild>
        <span className={className} onClick={onClick} role="button" tabIndex={0}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="bg-zinc-800 text-zinc-200 border border-zinc-700 px-3 py-2 max-w-xs">
        <p className="text-xs font-semibold">#{ticket.number} {ticket.title}</p>
        <span className={`inline-block mt-1 text-[10px] text-white rounded px-1.5 py-0.5 ${statusColors[ticket.status] ?? 'bg-zinc-600'}`}>
          {ticket.status.replace('_', ' ')}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
