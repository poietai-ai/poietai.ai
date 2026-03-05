import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Merge } from 'lucide-react';
import type { CanvasNode } from '../../../types/canvas';

export function FanInNode({ data }: NodeProps<CanvasNode>) {
  return (
    <div className="bg-emerald-50 border border-emerald-300 rounded-lg px-4 py-3 w-[300px] shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-emerald-400" />
      <div className="flex items-center gap-2">
        <Merge size={14} className="text-emerald-500" />
        <span className="text-emerald-700 text-xs font-semibold uppercase tracking-wide">Fan In</span>
      </div>
      {data.mergeStatus && (
        <p className="text-emerald-600 text-xs mt-1">{data.mergeStatus as string}</p>
      )}
      <Handle type="source" position={Position.Right} className="!bg-emerald-400" />
    </div>
  );
}
