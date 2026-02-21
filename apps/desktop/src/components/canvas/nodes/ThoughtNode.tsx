import { useState, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../../../types/canvas';

function BouncingDots() {
  return (
    <span className="inline-flex gap-0.5 items-end ml-0.5">
      <span className="inline-block animate-bounce [animation-delay:0ms]">.</span>
      <span className="inline-block animate-bounce [animation-delay:150ms]">.</span>
      <span className="inline-block animate-bounce [animation-delay:300ms]">.</span>
    </span>
  );
}

export function ThoughtNode({ data }: NodeProps<CanvasNode>) {
  const isThinking = data.nodeType === 'thought';
  const [revealed, setRevealed] = useState(!isThinking);

  useEffect(() => {
    if (!isThinking) return;
    const timer = setTimeout(() => setRevealed(true), 1200);
    return () => clearTimeout(timer);
  }, [isThinking]);

  return (
    <div className="bg-indigo-950 border border-indigo-700 rounded-lg p-3 max-w-xs shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-indigo-500" />
      <div className="flex items-start gap-2">
        <span className="text-indigo-400 text-sm mt-0.5 flex-shrink-0">💭</span>
        <p className="text-indigo-100 text-xs leading-relaxed line-clamp-4">
          {revealed
            ? data.content
            : <span className="italic text-indigo-300">Thinking<BouncingDots /></span>
          }
        </p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-indigo-500" />
    </div>
  );
}
