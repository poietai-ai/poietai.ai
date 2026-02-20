import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../../../types/canvas';

export function ThoughtNode({ data }: NodeProps<CanvasNode>) {
  return (
    <div className="bg-indigo-950 border border-indigo-700 rounded-lg p-3 max-w-xs shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-indigo-500" />
      <div className="flex items-start gap-2">
        <span className="text-indigo-400 text-sm mt-0.5 flex-shrink-0">💭</span>
        <p className="text-indigo-100 text-xs leading-relaxed line-clamp-4">
          {data.content}
        </p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-indigo-500" />
    </div>
  );
}
