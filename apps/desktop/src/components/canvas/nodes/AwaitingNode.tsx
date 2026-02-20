import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../../../types/canvas';

export function AwaitingNode({ data }: NodeProps<CanvasNode>) {
  return (
    <div className="bg-amber-950 border-2 border-amber-500 rounded-lg p-3 max-w-xs shadow-lg animate-pulse">
      <Handle type="target" position={Position.Top} />
      <div className="flex items-start gap-2">
        <span className="text-amber-400 text-sm mt-0.5 flex-shrink-0">⏸</span>
        <div>
          <p className="text-amber-200 text-xs font-semibold mb-1">Waiting for you</p>
          <p className="text-amber-100 text-xs leading-relaxed line-clamp-3">
            {data.content}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
