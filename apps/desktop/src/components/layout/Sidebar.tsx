import {
  LayoutDashboard, Hash, Columns3, GitBranch, Inbox, Settings2,
} from 'lucide-react';

const navItems = [
  { label: 'Dashboard', Icon: LayoutDashboard, id: 'dashboard' },
  { label: 'Rooms',     Icon: Hash,            id: 'rooms'     },
  { label: 'Board',     Icon: Columns3,        id: 'board'     },
  { label: 'Graph',     Icon: GitBranch,       id: 'graph'     },
  { label: 'Messages',  Icon: Inbox,           id: 'messages'  },
];

interface SidebarProps {
  activeView: string;
  onNavigate: (view: string) => void;
  onSettings: () => void;
}

export function Sidebar({ activeView, onNavigate, onSettings }: SidebarProps) {
  return (
    <aside className="w-16 flex flex-col items-center py-4 gap-2 bg-zinc-950 border-r border-zinc-800">
      <div className="mb-4 w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
        <span className="text-white text-xs font-bold">P</span>
      </div>
      {navItems.map(({ label, Icon, id }) => (
        <button
          key={id}
          type="button"
          onClick={() => onNavigate(id)}
          className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
            activeView === id
              ? 'bg-violet-600 text-white'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
          }`}
          title={label}
        >
          <Icon size={18} strokeWidth={1.5} />
        </button>
      ))}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onSettings}
        title="Settings"
        className="w-10 h-10 rounded-lg flex items-center justify-center
                   text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
      >
        <Settings2 size={18} strokeWidth={1.5} />
      </button>
    </aside>
  );
}
