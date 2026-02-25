import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

export function SecurityResultNode({ data }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const summary = nodeData.securitySummary ?? { critical: 0, warnings: 0 };
  const hasCritical = summary.critical > 0;

  const colorClass = hasCritical
    ? 'bg-red-950 border-red-700 text-red-200'
    : 'bg-green-950 border-green-700 text-green-200';

  return (
    <div className={['px-4 py-3 rounded-lg border font-mono text-xs w-64 select-none', colorClass].join(' ')}>
      <div className="text-[10px] uppercase tracking-wider mb-2 text-zinc-400">Security Report</div>
      <div className="flex gap-4">
        <div className="text-center">
          <div className={`font-bold text-base ${hasCritical ? 'text-red-400' : 'text-zinc-500'}`}>
            {summary.critical}
          </div>
          <div className="text-zinc-500 text-[10px]">critical</div>
        </div>
        <div className="text-center">
          <div className={`font-bold text-base ${summary.warnings > 0 ? 'text-yellow-400' : 'text-zinc-500'}`}>
            {summary.warnings}
          </div>
          <div className="text-zinc-500 text-[10px]">warnings</div>
        </div>
      </div>
      {hasCritical && (
        <div className="mt-2 text-red-400 text-[10px] font-semibold">
          Critical vulnerabilities — ticket blocked
        </div>
      )}
      <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
    </div>
  );
}
