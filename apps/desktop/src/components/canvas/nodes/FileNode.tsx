import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

const NODE_STYLES = {
  file_read:  { icon: '📄', border: 'border-blue-700',    bg: 'bg-blue-950',    text: 'text-blue-200'    },
  file_edit:  { icon: '✏️',  border: 'border-green-700',   bg: 'bg-green-950',   text: 'text-green-200'   },
  file_write: { icon: '🆕', border: 'border-emerald-700', bg: 'bg-emerald-950', text: 'text-emerald-200' },
} as const;

export function FileNode({ data }: NodeProps<Node<CanvasNodeData>>) {
  const style = NODE_STYLES[data.nodeType as keyof typeof NODE_STYLES] ?? NODE_STYLES.file_read;

  return (
    <div className={`${style.bg} border ${style.border} rounded-lg p-3 min-w-48 shadow-lg`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2">
        <span className="text-sm flex-shrink-0">{style.icon}</span>
        <span className={`${style.text} text-xs font-mono truncate max-w-48`}>
          {data.filePath ?? 'unknown file'}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
