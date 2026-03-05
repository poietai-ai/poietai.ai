import { useEffect, useRef } from 'react';

interface ContextMenuAction {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

interface TicketContextMenuProps {
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onClose: () => void;
}

export function TicketContextMenu({ x, y, actions, onClose }: TicketContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-lg py-1 shadow-xl min-w-[160px]"
      style={{ left: x, top: y }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => { action.onClick(); onClose(); }}
          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-800 transition-colors ${
            action.danger ? 'text-red-400 hover:text-red-300' : 'text-zinc-300 hover:text-white'
          }`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
