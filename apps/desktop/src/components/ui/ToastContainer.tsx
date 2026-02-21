import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useToastStore, type AgentToast } from '../../store/toastStore';

const AUTO_DISMISS_MS = 6000;

function Toast({ toast, onDismiss }: { toast: AgentToast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`flex items-start gap-3 rounded-xl p-3 shadow-2xl w-80
                  bg-zinc-800 border transition-all
                  ${toast.isQuestion
                    ? 'border-amber-500/60'
                    : 'border-zinc-600/60'
                  }`}
    >
      <div className="w-9 h-9 rounded-full bg-violet-700 flex items-center justify-center
                      text-white text-sm font-bold flex-shrink-0">
        {toast.agentName[0]?.toUpperCase() ?? '?'}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <span className="text-white text-sm font-semibold truncate">{toast.agentName}</span>
          {toast.isQuestion && (
            <span className="text-amber-400 text-xs flex-shrink-0">needs your input</span>
          )}
        </div>
        <p className="text-zinc-300 text-xs leading-relaxed line-clamp-2">
          {toast.message}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="text-zinc-500 hover:text-zinc-300 flex-shrink-0 mt-0.5 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, dismissToast } = useToastStore();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-20 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast toast={toast} onDismiss={dismissToast} />
        </div>
      ))}
    </div>
  );
}
