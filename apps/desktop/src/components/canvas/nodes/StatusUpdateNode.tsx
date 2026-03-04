import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Radio } from 'lucide-react';
import type { CanvasNode } from '../../../types/canvas';

export function StatusUpdateNode({ data }: NodeProps<CanvasNode>) {
  return (
    <div className="bg-zinc-50 border border-zinc-200 rounded-md px-3 py-1.5 max-w-xs shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-zinc-300" />
      <div className="flex items-center gap-2">
        <Radio size={12} className="text-zinc-400 flex-shrink-0" />
        <span className="text-zinc-500 text-xs">{data.content as string}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-zinc-300" />
    </div>
  );
}
