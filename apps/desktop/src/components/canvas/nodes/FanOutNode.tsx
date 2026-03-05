import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Split } from 'lucide-react';
import type { CanvasNode } from '../../../types/canvas';

export function FanOutNode({ data }: NodeProps<CanvasNode>) {
  const groups = (data.groups as { group_id: string; agent_role: string }[] | undefined) ?? [];

  return (
    <div className="bg-purple-50 border border-purple-300 rounded-lg px-4 py-3 w-[300px] shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-purple-400" />
      <div className="flex items-center gap-2 mb-2">
        <Split size={14} className="text-purple-500" />
        <span className="text-purple-700 text-xs font-semibold uppercase tracking-wide">Fan Out</span>
      </div>
      {groups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => (
            <span
              key={g.group_id}
              className="bg-purple-100 text-purple-700 text-[11px] px-2 py-0.5 rounded-full"
            >
              {g.agent_role}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-purple-400" />
    </div>
  );
}
