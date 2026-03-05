import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

const appWindow = getCurrentWindow();

export function Titlebar() {
  const handleDragStart = (e: React.MouseEvent) => {
    // Only drag on left-click, and not when clicking buttons
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    appWindow.startDragging();
  };

  return (
    <div
      onMouseDown={handleDragStart}
      className="flex items-center justify-between h-8 bg-violet-700 select-none"
    >
      {/* App title — left side */}
      <span className="pl-3 text-xs font-semibold text-white/90 tracking-wide pointer-events-none">
        Poietai.AI
      </span>

      {/* Window controls — right side */}
      <div className="flex h-full">
        <button
          type="button"
          onClick={() => appWindow.minimize()}
          className="h-full px-3 text-white/70 hover:bg-white/10 transition-colors flex items-center"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          onClick={() => appWindow.toggleMaximize()}
          className="h-full px-3 text-white/70 hover:bg-white/10 transition-colors flex items-center"
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          onClick={() => appWindow.close()}
          className="h-full px-3 text-white/70 hover:bg-red-500 transition-colors flex items-center"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
