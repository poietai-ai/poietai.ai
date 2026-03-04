import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileText, FilePen, FilePlus2 } from 'lucide-react';
import type { CanvasNode } from '../../../types/canvas';

const NODE_STYLES = {
  file_read:  { Icon: FileText,  bar: 'border-l-blue-500',    iconCls: 'text-blue-600',    verb: 'Read'   },
  file_edit:  { Icon: FilePen,   bar: 'border-l-green-500',   iconCls: 'text-green-600',   verb: 'Edited' },
  file_write: { Icon: FilePlus2, bar: 'border-l-emerald-500', iconCls: 'text-emerald-600', verb: 'Wrote'  },
} as const;

function shortPath(p: string) {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : p;
}

export function FileNode({ data }: NodeProps<CanvasNode>) {
  const style = NODE_STYLES[data.nodeType as keyof typeof NODE_STYLES] ?? NODE_STYLES.file_read;
  const items = (data.items as string[] | undefined) ?? (data.filePath ? [data.filePath] : []);
  const count = items.length;
  const fileContent = data.fileContent as string | undefined;
  const { Icon } = style;

  return (
    <div className={`bg-white border border-zinc-200 border-l-4 ${style.bar}
                     rounded-lg p-3 min-w-48 max-w-sm shadow-sm`}>
      <Handle type="target" position={Position.Left} />

      {/* Header row */}
      <div className="flex items-center gap-2">
        <Icon size={14} strokeWidth={1.5} className={`${style.iconCls} flex-shrink-0`} />
        <span className="text-zinc-700 text-xs font-mono flex-1 truncate">
          {count > 1
            ? `${style.verb} ${count} files`
            : shortPath(items[0] ?? 'unknown')
          }
        </span>
      </div>

      {/* Multi-file list — always expanded */}
      {count > 1 && (
        <ul className="mt-2 space-y-1 border-t border-zinc-100 pt-2">
          {items.map((item) => (
            <li key={item} className="text-zinc-500 text-xs font-mono truncate">
              {shortPath(item)}
            </li>
          ))}
        </ul>
      )}

      {/* File content — always shown when available */}
      {data.nodeType === 'file_read' && fileContent && (
        <pre className="mt-2 text-zinc-600 text-xs font-mono leading-relaxed
                        bg-zinc-50 border border-zinc-100
                        rounded p-2 whitespace-pre-wrap break-all">
          {fileContent}
        </pre>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
