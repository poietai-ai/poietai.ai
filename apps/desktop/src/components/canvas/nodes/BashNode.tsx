import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../../../types/canvas';

function extractCommand(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed['command'] === 'string') return parsed['command'];
  } catch { /* use raw */ }
  return raw;
}

/** Trim command to first line, max 50 chars. */
function shortCmd(s: string) {
  const first = s.split('\n')[0];
  return first.length > 50 ? first.slice(0, 50) + '…' : first;
}

export function BashNode({ data }: NodeProps<CanvasNode>) {
  const [expanded, setExpanded] = useState(false);
  const items = data.items as string[] | undefined;
  const count = items?.length ?? 0;

  // Single-item mode: extract command from the stored JSON content
  const singleCommand = count <= 1
    ? shortCmd(items?.[0] ?? extractCommand(data.content))
    : null;

  return (
    <div className="bg-orange-950 border border-orange-700 rounded-lg p-3 max-w-xs shadow-lg">
      <Handle type="target" position={Position.Top} />

      <button
        type="button"
        onClick={() => count > 1 && setExpanded(!expanded)}
        className="flex items-start gap-2 w-full text-left"
      >
        <span className="text-orange-400 text-sm mt-0.5 flex-shrink-0">⚙️</span>
        <code className="text-orange-100 text-xs font-mono flex-1 truncate">
          {count > 1 ? `${count} commands` : singleCommand}
        </code>
        {count > 1 && (
          <span className="text-neutral-500 text-xs flex-shrink-0">{expanded ? '▲' : '▼'}</span>
        )}
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1 max-h-36 overflow-y-auto border-t border-white/10 pt-2">
          {items!.map((item, i) => (
            <li key={i}>
              <code className="text-orange-100 text-xs font-mono opacity-75 block truncate">
                {shortCmd(item)}
              </code>
            </li>
          ))}
        </ul>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
