import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../../../types/canvas';

export function BashNode({ data }: NodeProps<CanvasNode>) {
  // content is a JSON string of tool_input — extract the command if present
  let command = data.content;
  try {
    const parsed = JSON.parse(data.content) as Record<string, unknown>;
    if (typeof parsed['command'] === 'string') command = parsed['command'];
  } catch {
    // use raw content as-is
  }

  return (
    <div className="bg-orange-950 border border-orange-700 rounded-lg p-3 max-w-xs shadow-lg">
      <Handle type="target" position={Position.Top} />
      <div className="flex items-start gap-2">
        <span className="text-orange-400 text-sm mt-0.5 flex-shrink-0">⚙️</span>
        <code className="text-orange-100 text-xs font-mono truncate max-w-56">
          {command}
        </code>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
