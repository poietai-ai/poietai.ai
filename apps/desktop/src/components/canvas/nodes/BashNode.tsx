import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Terminal } from 'lucide-react';
import type { CanvasNode } from '../../../types/canvas';

function extractCommand(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed['command'] === 'string') return parsed['command'];
  } catch { /* use raw */ }
  return raw;
}

export function BashNode({ data }: NodeProps<CanvasNode>) {
  const items = data.items as string[] | undefined;
  const count = items?.length ?? 0;

  const singleCommand = count <= 1
    ? (items?.[0] ?? extractCommand(data.content))
    : null;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 max-w-sm shadow-sm">
      <Handle type="target" position={Position.Left} />

      <div className="flex items-start gap-2">
        <Terminal size={14} strokeWidth={1.5} className="text-zinc-400 mt-0.5 flex-shrink-0" />
        {count > 1 ? (
          <div className="flex-1 min-w-0">
            <code className="text-zinc-300 text-xs font-mono">{count} commands</code>
            <ul className="mt-2 space-y-1 border-t border-zinc-700 pt-2">
              {items!.map((item, i) => (
                <li key={i}>
                  <code className="text-zinc-300 text-xs font-mono block whitespace-pre-wrap break-all">
                    {item}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <code className="text-zinc-100 text-xs font-mono flex-1 whitespace-pre-wrap break-all">
            {singleCommand}
          </code>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
