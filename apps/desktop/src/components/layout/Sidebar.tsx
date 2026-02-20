const navItems = [
  { label: 'Dashboard', icon: '⌂', id: 'dashboard' },
  { label: 'Rooms', icon: '◉', id: 'rooms' },
  { label: 'Board', icon: '▦', id: 'board' },
  { label: 'Graph', icon: '⬡', id: 'graph' },
  { label: 'Messages', icon: '✉', id: 'messages' },
];

interface SidebarProps {
  activeView: string;
  onNavigate: (view: string) => void;
  onSettings: () => void;
}

export function Sidebar({ activeView, onNavigate, onSettings }: SidebarProps) {
  return (
    <aside className="w-16 flex flex-col items-center py-4 gap-2 bg-neutral-950 border-r border-neutral-800">
      <div className="mb-4 w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
        <span className="text-white text-xs font-bold">N</span>
      </div>
      {navItems.map((item) => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-colors ${
            activeView === item.id
              ? 'bg-indigo-600 text-white'
              : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
          }`}
          title={item.label}
        >
          {item.icon}
        </button>
      ))}
      <div className="flex-1" />
      <button
        onClick={onSettings}
        title="Settings"
        className="w-10 h-10 rounded-lg flex items-center justify-center text-xl
                   text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
      >
        ⚙
      </button>
    </aside>
  );
}
