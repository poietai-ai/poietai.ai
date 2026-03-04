import { Handle, Position, type NodeProps } from '@xyflow/react';
import { MessageSquare } from 'lucide-react';
import type { CanvasNode } from '../../../types/canvas';
import { Markdown } from './Markdown';

/** Agent's actual output — prominent, violet accent, markdown rendered, fully expanded. */
export function AgentMessageNode({ data }: NodeProps<CanvasNode>) {
  const content = data.content as string;

  return (
    <div className="bg-white border border-zinc-200 border-l-4 border-l-violet-500
                    rounded-lg p-3 max-w-sm shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-violet-400" />
      <div className="flex items-start gap-2">
        <MessageSquare size={14} strokeWidth={1.5} className="text-violet-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <Markdown className="text-zinc-700">{content}</Markdown>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-violet-400" />
    </div>
  );
}
