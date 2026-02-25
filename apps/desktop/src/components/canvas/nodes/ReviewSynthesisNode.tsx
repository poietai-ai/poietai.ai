import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

export function ReviewSynthesisNode({ data }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const s = nodeData.synthesisSummary ?? {
    validate: { critical: 0, verified: 0 },
    qa: { critical: 0, warnings: 0, advisory: 0 },
    security: { critical: 0, warnings: 0 },
  };

  const totalCritical = s.validate.critical + s.qa.critical + s.security.critical;
  const isReady = totalCritical === 0;

  return (
    <div className={[
      'px-4 py-3 rounded-lg border font-mono text-xs w-72 select-none',
      isReady
        ? 'bg-green-950 border-green-600 text-green-100'
        : 'bg-red-950 border-red-700 text-red-200',
    ].join(' ')}>
      <div className="text-[10px] uppercase tracking-wider mb-3 text-zinc-400">Ship Readiness</div>

      <div className="space-y-1.5 mb-3">
        <ReviewRow
          label="VALIDATE"
          ok={s.validate.critical === 0}
          detail={s.validate.critical === 0
            ? `${s.validate.verified} verified`
            : `${s.validate.critical} critical`}
        />
        <ReviewRow
          label="QA"
          ok={s.qa.critical === 0}
          detail={s.qa.critical === 0
            ? `${s.qa.warnings}w ${s.qa.advisory}a`
            : `${s.qa.critical} critical`}
        />
        <ReviewRow
          label="SECURITY"
          ok={s.security.critical === 0}
          detail={s.security.critical === 0
            ? `${s.security.warnings} warnings`
            : `${s.security.critical} critical`}
        />
      </div>

      <div className={[
        'text-[11px] font-bold uppercase tracking-wide pt-2 border-t',
        isReady ? 'border-green-800 text-green-400' : 'border-red-800 text-red-400',
      ].join(' ')}>
        {isReady ? 'Ready to ship' : `Blocked — ${totalCritical} critical issue${totalCritical !== 1 ? 's' : ''}`}
      </div>

      <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
    </div>
  );
}

function ReviewRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] font-semibold w-16 flex-shrink-0 ${ok ? 'text-green-400' : 'text-red-400'}`}>
        {label}
      </span>
      <span className={`text-[10px] ${ok ? 'text-zinc-400' : 'text-red-300'}`}>
        {ok ? '✓' : '✗'} {detail}
      </span>
    </div>
  );
}
