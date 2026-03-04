import type { NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

const ACTION_COLORS = {
  create: 'text-emerald-400',
  modify: 'text-violet-400',
  delete: 'text-red-400',
} as const;

export function PlanTaskNode({ data }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const activated = nodeData.activated ?? false;
  const action = (nodeData.action ?? 'modify') as keyof typeof ACTION_COLORS;
  const filePath = String(nodeData.filePath ?? '');
  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1] ?? filePath;

  return (
    <div
      className={[
        'px-3 py-2 rounded-lg border font-mono text-xs w-56 transition-all duration-300 select-none',
        activated
          ? 'bg-zinc-800 border-violet-600 text-zinc-200'
          : 'bg-zinc-950 border-zinc-700 border-dashed text-zinc-500 opacity-50',
      ].join(' ')}
    >
      <div className={`text-[10px] uppercase tracking-wider mb-1 ${ACTION_COLORS[action]}`}>
        {action}
      </div>
      <div className="font-semibold">{fileName}</div>
      <div className="text-zinc-500 mt-0.5 text-[10px] leading-relaxed">
        {String(nodeData.content)}
      </div>
    </div>
  );
}
