import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../../../types/canvas';

const NODE_STYLES = {
  file_read:  { icon: '📄', border: 'border-blue-700',    bg: 'bg-blue-950',    text: 'text-blue-200',    verb: 'Read'   },
  file_edit:  { icon: '✏️',  border: 'border-green-700',   bg: 'bg-green-950',   text: 'text-green-200',   verb: 'Edited' },
  file_write: { icon: '🆕', border: 'border-emerald-700', bg: 'bg-emerald-950', text: 'text-emerald-200', verb: 'Wrote'  },
} as const;

/** Show the last 2 path segments: `/home/.../src/cart.ts` → `src/cart.ts`. */
function shortPath(p: string) {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : p;
}

export function FileNode({ data }: NodeProps<CanvasNode>) {
  const [expanded, setExpanded] = useState(false);
  const style = NODE_STYLES[data.nodeType as keyof typeof NODE_STYLES] ?? NODE_STYLES.file_read;
  const items = (data.items as string[] | undefined) ?? (data.filePath ? [data.filePath] : []);
  const count = items.length;

  return (
    <div className={`${style.bg} border ${style.border} rounded-lg p-3 min-w-48 max-w-xs shadow-lg`}>
      <Handle type="target" position={Position.Top} />

      <button
        type="button"
        onClick={() => count > 1 && setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className="text-sm flex-shrink-0">{style.icon}</span>
        <span className={`${style.text} text-xs font-mono flex-1 truncate`}>
          {count > 1
            ? `${style.verb} ${count} files`
            : shortPath(items[0] ?? 'unknown')
          }
        </span>
        {count > 1 && (
          <span className="text-neutral-500 text-xs flex-shrink-0">{expanded ? '▲' : '▼'}</span>
        )}
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1 max-h-36 overflow-y-auto border-t border-white/10 pt-2">
          {items.map((item, i) => (
            <li key={i} className={`${style.text} text-xs font-mono opacity-75 truncate`}>
              {shortPath(item)}
            </li>
          ))}
        </ul>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
