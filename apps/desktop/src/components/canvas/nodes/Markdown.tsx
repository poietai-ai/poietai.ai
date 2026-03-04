import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownProps {
  children: string;
  className?: string;
}

/** Renders markdown content with GFM support, sized for canvas nodes. */
export function Markdown({ children, className = '' }: MarkdownProps) {
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
        [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs
        [&_pre]:bg-zinc-50 [&_pre]:border [&_pre]:border-zinc-200 [&_pre]:rounded [&_pre]:p-2 [&_pre]:my-1 [&_pre]:overflow-x-auto
        [&_pre_code]:bg-transparent [&_pre_code]:p-0
        [&_strong]:font-semibold
        [&_a]:text-violet-600 [&_a]:no-underline hover:[&_a]:underline
        [&_table]:text-xs [&_th]:text-left [&_th]:px-2 [&_th]:py-1 [&_th]:border-b [&_th]:border-zinc-200
        [&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-zinc-100
        ${className}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
