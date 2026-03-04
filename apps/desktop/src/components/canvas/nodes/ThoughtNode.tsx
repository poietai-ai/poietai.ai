import { useState, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Brain } from 'lucide-react';
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

/** Internal reasoning — muted, dashed border, fully expanded. */
export function ThoughtNode({ data }: NodeProps<CanvasNode>) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  const content = data.content as string;

  return (
    <div className="bg-zinc-50 border border-dashed border-zinc-300
                    rounded-lg p-3 max-w-sm shadow-sm opacity-75">
      <Handle type="target" position={Position.Left} className="!bg-zinc-300" />
      <div className="flex items-start gap-2">
        <Brain size={12} strokeWidth={1.5} className="text-zinc-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          {!revealed ? (
            <p className="text-zinc-400 text-xs italic">
              Thinking<BouncingDots />
            </p>
          ) : (
            <p className="text-zinc-500 text-xs leading-relaxed whitespace-pre-wrap">
              {content}
            </p>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-zinc-300" />
    </div>
  );
}
