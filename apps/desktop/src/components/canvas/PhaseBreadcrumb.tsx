import type { TicketPhase } from '../../store/ticketStore';

const PHASE_LABELS: Record<TicketPhase, string> = {
  brief:    'Brief',
  design:   'Design',
  review:   'Review',
  plan:     'Plan',
  build:    'Build',
  validate: 'Validate',
  qa:       'QA',
  security: 'Security',
  ship:     'Ship',
};

interface Props {
  phases: TicketPhase[];
  activePhase?: TicketPhase;
}

export function PhaseBreadcrumb({ phases, activePhase }: Props) {
  return (
    <div className="flex items-center gap-1 px-4 py-2 text-xs font-mono border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm select-none">
      {phases.map((phase, i) => {
        const isActive = phase === activePhase;
        const isDone = activePhase
          ? phases.indexOf(activePhase) > i
          : false;

        return (
          <span key={phase} className="flex items-center gap-1">
            {i > 0 && (
              <span className="text-zinc-700">›</span>
            )}
            <span
              className={
                isActive
                  ? 'text-violet-400 font-semibold'
                  : isDone
                    ? 'text-zinc-600 line-through'
                    : 'text-zinc-600'
              }
            >
              {PHASE_LABELS[phase]}
            </span>
          </span>
        );
      })}
    </div>
  );
}
