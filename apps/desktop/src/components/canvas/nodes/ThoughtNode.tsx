import { useState, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!isThinking) return;
    const timer = setTimeout(() => setRevealed(true), 1200);
    return () => clearTimeout(timer);
  }, [isThinking]);

  const content = data.content as string;
  const isLong = content.length > 160;

  return (
    <div className="bg-white border border-zinc-200 border-l-4 border-l-violet-500
                    rounded-lg p-3 max-w-xs shadow-sm">
      <Handle type="target" position={Position.Top} className="!bg-violet-400" />
      <div className="flex items-start gap-2">
        <Sparkles size={14} strokeWidth={1.5} className="text-violet-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          {!revealed ? (
            <p className="text-zinc-400 text-xs italic">
              Thinking<BouncingDots />
            </p>
          ) : (
            <>
              <p className={`text-zinc-700 text-xs leading-relaxed ${!expanded ? 'line-clamp-3' : ''}`}>
                {content}
              </p>
              {isLong && (
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-0.5 text-violet-500 hover:text-violet-600 text-xs mt-1"
                >
                  {expanded
                    ? <><ChevronUp size={12} /> show less</>
                    : <><ChevronDown size={12} /> show more</>}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-violet-400" />
    </div>
  );
}
