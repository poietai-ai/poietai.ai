import type { NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

export function PhaseBoxNode({ data }: NodeProps) {
  const { boxWidth, boxHeight, bgColor, borderColor, content } = data as CanvasNodeData;

  return (
    <div
      style={{
        width: boxWidth ?? 200,
        height: boxHeight ?? 100,
        backgroundColor: bgColor ?? 'transparent',
        border: `1px solid ${borderColor ?? 'transparent'}`,
        borderRadius: 12,
        pointerEvents: 'none',
        position: 'relative',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 10,
          left: 14,
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: borderColor ?? '#888',
          opacity: 0.7,
        }}
      >
        {content}
      </span>
    </div>
  );
}
