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
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!isThinking) return;
    const timer = setTimeout(() => setRevealed(true), 1200);
    return () => clearTimeout(timer);
  }, [isThinking]);

  const content = data.content as string;
  const isLong = content.length > 160;

  return (
    <div className="bg-indigo-950 border border-indigo-700 rounded-lg p-3 max-w-xs shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-indigo-500" />
      <div className="flex items-start gap-2">
        <span className="text-indigo-400 text-sm mt-0.5 flex-shrink-0">💭</span>
        <div className="flex-1 min-w-0">
          {!revealed ? (
            <p className="text-indigo-300 text-xs italic">
              Thinking<BouncingDots />
            </p>
          ) : (
            <>
              <p className={`text-indigo-100 text-xs leading-relaxed ${!expanded ? 'line-clamp-3' : ''}`}>
                {content}
              </p>
              {isLong && (
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="text-indigo-400 hover:text-indigo-200 text-xs mt-1"
                >
                  {expanded ? 'show less' : 'show more'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-indigo-500" />
    </div>
  );
}
