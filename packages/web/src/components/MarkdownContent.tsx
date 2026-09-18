import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * Renders a lesson (or any) description written in Markdown.
 *
 * Authored by Kosmos staff and shown below the video, so it has to turn a
 * pasted link into a real one and support a little formatting — bold, lists —
 * without becoming an XSS hole. `react-markdown` never renders raw HTML (we do
 * not add `rehype-raw`) and sanitises URLs by default, so `javascript:` links
 * and injected tags cannot survive; every element is mapped to a plain,
 * token-styled tag here rather than trusting a global stylesheet. Links open in
 * a new tab and carry `rel="noopener"`, because the author is not the reader.
 *
 * `remark-gfm` adds the friendly extras staff expect from "the app I paste
 * links into": bare URLs become links, and `-`/`1.` lists just work.
 */
export function MarkdownContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-3 text-sm leading-relaxed text-muted-foreground', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener nofollow"
              className="font-medium text-accent-foreground underline underline-offset-2 hover:text-foreground"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          h1: ({ children }) => (
            <h3 className="text-base font-semibold text-foreground">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="text-base font-semibold text-foreground">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="text-sm font-semibold text-foreground">{children}</h4>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 italic">{children}</blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
