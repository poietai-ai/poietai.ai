import { type ReactNode, isValidElement, Children, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';
import { parseTokens } from '../../../lib/tokenParser';
import { TokenChip } from '../../messages/TokenChip';

interface MarkdownProps {
  children: string;
  className?: string;
  /** Use 'dark' for dark backgrounds (DM bubbles), default 'light' for canvas nodes. */
  variant?: 'light' | 'dark';
  /** When true, parse @mentions, #tickets, /commands into interactive pill chips. */
  tokenize?: boolean;
  /** Known agent names for multi-word mention matching. */
  agentNames?: string[];
}

/** Recursively walk React children, tokenizing strings while skipping code/pre elements. */
function tokenizeChildren(children: ReactNode, agentNames?: string[]): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') {
      const segments = parseTokens(child, agentNames);
      if (segments.length === 1 && segments[0].type === 'text') return child;
      return segments.map((seg, i) =>
        seg.type === 'text' ? (
          seg.value
        ) : (
          <TokenChip key={i} tokenType={seg.tokenType} raw={seg.raw} value={seg.value} />
        ),
      );
    }

    // Skip code/pre elements — don't tokenize inside them
    if (isValidElement(child)) {
      const el = child as React.ReactElement<{ children?: ReactNode }>;
      const tag = typeof el.type === 'string' ? el.type : '';
      if (tag === 'code' || tag === 'pre') return child;
    }

    return child;
  });
}

/** Code block wrapper with sticky copy button. */
function CodeBlock({ children, variant }: { children?: ReactNode; variant: 'light' | 'dark' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = extractText(children);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);

  const btnColor = variant === 'dark'
    ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
    : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-600';

  return (
    <div className="relative group/code my-1">
      <div className="sticky top-0 z-10 h-0 flex justify-end pointer-events-none">
        <button
          type="button"
          onClick={handleCopy}
          className={`pointer-events-auto mt-1.5 mr-1.5 p-1 rounded text-[10px] transition-all opacity-0 group-hover/code:opacity-100 ${btnColor}`}
          title="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre className="!my-0 pr-8">{children}</pre>
    </div>
  );
}

/** Recursively extract plain text from React children. */
function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node)) {
    const el = node as React.ReactElement<{ children?: ReactNode }>;
    return extractText(el.props.children);
  }
  return '';
}

/** Renders markdown content with GFM support, sized for canvas nodes. */
export function Markdown({ children, className = '', variant = 'light', tokenize = false, agentNames }: MarkdownProps) {
  const codeStyles = variant === 'dark'
    ? '[&_code]:bg-zinc-700 [&_code]:text-violet-300'
    : '[&_code]:bg-zinc-100';
  const preStyles = variant === 'dark'
    ? '[&_pre]:bg-zinc-900/80 [&_pre]:border-zinc-700 [&_pre_code]:text-zinc-300'
    : '[&_pre]:bg-zinc-50 [&_pre]:border-zinc-200';
  const linkStyles = variant === 'dark'
    ? '[&_a]:text-violet-400'
    : '[&_a]:text-violet-600';
  const tableStyles = variant === 'dark'
    ? '[&_th]:border-zinc-700 [&_td]:border-zinc-700'
    : '[&_th]:border-zinc-200 [&_td]:border-zinc-100';

  const baseComponents = {
    pre: ({ children: c }: { children?: ReactNode }) => (
      <CodeBlock variant={variant}>{c}</CodeBlock>
    ),
  };

  const tokenComponents = tokenize
    ? {
        ...baseComponents,
        p: ({ children: c }: { children?: ReactNode }) => <p>{tokenizeChildren(c, agentNames)}</p>,
        li: ({ children: c }: { children?: ReactNode }) => <li>{tokenizeChildren(c, agentNames)}</li>,
        td: ({ children: c }: { children?: ReactNode }) => <td>{tokenizeChildren(c, agentNames)}</td>,
        em: ({ children: c }: { children?: ReactNode }) => <em>{tokenizeChildren(c, agentNames)}</em>,
        strong: ({ children: c }: { children?: ReactNode }) => <strong>{tokenizeChildren(c, agentNames)}</strong>,
      }
    : baseComponents;

  return (
    <div
      className={`max-w-none text-xs leading-relaxed
        [&_h1]:text-xs [&_h1]:font-semibold [&_h1]:mb-1 [&_h1]:mt-2
        [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:mb-1 [&_h2]:mt-2
        [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2
        [&_p]:my-1
        [&_ul]:my-1 [&_ul]:pl-4 [&_ul]:list-disc
        [&_ol]:my-1 [&_ol]:pl-4 [&_ol]:list-decimal
        [&_li]:my-0
        ${codeStyles} [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs
        ${preStyles} [&_pre]:border [&_pre]:rounded [&_pre]:p-2 [&_pre]:my-1 [&_pre]:overflow-x-auto
        [&_pre_code]:bg-transparent [&_pre_code]:p-0
        [&_strong]:font-semibold
        ${linkStyles} [&_a]:no-underline hover:[&_a]:underline
        [&_table]:text-xs [&_th]:text-left [&_th]:px-2 [&_th]:py-1 [&_th]:border-b
        [&_td]:px-2 [&_td]:py-1 [&_td]:border-b ${tableStyles}
        ${className}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={tokenComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
