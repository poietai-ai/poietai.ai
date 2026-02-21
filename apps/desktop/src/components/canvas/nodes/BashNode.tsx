import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Terminal, ChevronDown, ChevronUp } from 'lucide-react';
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

  const singleCommand = count <= 1
    ? shortCmd(items?.[0] ?? extractCommand(data.content))
    : null;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 max-w-xs shadow-sm">
      <Handle type="target" position={Position.Top} />

      <button
        type="button"
        onClick={() => count > 1 && setExpanded(!expanded)}
        className="flex items-start gap-2 w-full text-left"
      >
        <Terminal size={14} strokeWidth={1.5} className="text-zinc-400 mt-0.5 flex-shrink-0" />
        <code className="text-zinc-100 text-xs font-mono flex-1 truncate">
          {count > 1 ? `${count} commands` : singleCommand}
        </code>
        {count > 1 && (
          <span className="text-zinc-500 flex-shrink-0">
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        )}
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1 max-h-36 overflow-y-auto border-t border-zinc-700 pt-2">
          {items!.map((item, i) => (
            <li key={i}>
              <code className="text-zinc-300 text-xs font-mono block truncate">
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
