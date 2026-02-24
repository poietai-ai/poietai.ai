import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

export function ValidateResultNode({ data }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const summary = nodeData.validateSummary ?? { verified: 0, critical: 0, advisory: 0 };
  const hasCritical = summary.critical > 0;

  return (
    <div
      className={[
        'px-4 py-3 rounded-lg border font-mono text-xs w-64 select-none',
        hasCritical
          ? 'bg-red-950 border-red-700 text-red-200'
          : 'bg-green-950 border-green-700 text-green-200',
      ].join(' ')}
    >
      <div className="text-[10px] uppercase tracking-wider mb-2 text-zinc-400">
        Validate Report
      </div>
      <div className="flex gap-4">
        <div className="text-center">
          <div className="text-green-400 font-bold text-base">{summary.verified}</div>
          <div className="text-zinc-500 text-[10px]">verified</div>
        </div>
        <div className="text-center">
          <div className={`font-bold text-base ${hasCritical ? 'text-red-400' : 'text-zinc-500'}`}>
            {summary.critical}
          </div>
          <div className="text-zinc-500 text-[10px]">critical</div>
        </div>
        <div className="text-center">
          <div className="text-yellow-400 font-bold text-base">{summary.advisory}</div>
          <div className="text-zinc-500 text-[10px]">advisory</div>
        </div>
      </div>
      {hasCritical && (
        <div className="mt-2 text-red-400 text-[10px] font-semibold">
          Critical drift detected — ticket blocked
        </div>
      )}
      <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
    </div>
  );
}
