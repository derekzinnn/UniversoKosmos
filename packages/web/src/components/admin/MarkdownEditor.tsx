import { Bold, Link2, List } from 'lucide-react';
import { useRef } from 'react';
import { MarkdownContent } from '@/components/MarkdownContent';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * A small Markdown editor for staff who do not know Markdown.
 *
 * The point is that nobody has to remember the syntax: the toolbar writes it.
 * Each button wraps the current selection (or drops a placeholder) in the right
 * markers — `**bold**`, `[text](url)`, a `- ` list — and a live preview under
 * the box shows exactly what the client will see below the video, rendered by
 * the same `MarkdownContent` that renders it for real. The textarea stays the
 * source of truth; the buttons are just a faster way to type into it.
 */

interface MarkdownEditorProps {
  readonly id?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly maxLength?: number;
  readonly placeholder?: string;
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  maxLength = 2000,
  placeholder,
}: MarkdownEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  /**
   * Wrap the current selection in `before`/`after`, or insert a placeholder
   * when nothing is selected, then restore focus with the inserted text (or
   * just its inner part) selected so the next keystroke replaces it.
   */
  function surround(before: string, after: string, placeholder: string) {
    const el = ref.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || placeholder;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    if (next.length > maxLength) return;

    onChange(next);

    // Re-select the inner text after React re-renders the controlled value.
    const innerStart = start + before.length;
    const innerEnd = innerStart + selected.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(innerStart, innerEnd);
    });
  }

  /** Prefix each line the selection touches with `- ` for a bullet list. */
  function toBulletList() {
    const el = ref.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const block = value.slice(lineStart, end) || 'item da lista';
    const bulleted = block
      .split('\n')
      .map((line) => (line.startsWith('- ') ? line : `- ${line}`))
      .join('\n');
    const next = value.slice(0, lineStart) + bulleted + value.slice(end);
    if (next.length > maxLength) return;

    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + bulleted.length);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <ToolbarButton label="Negrito" onClick={() => surround('**', '**', 'texto em negrito')}>
          <Bold className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Link"
          onClick={() => surround('[', '](https://)', 'texto do link')}
        >
          <Link2 className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Lista" onClick={toBulletList}>
          <List className="size-4" aria-hidden />
        </ToolbarButton>
      </div>

      <Textarea
        id={id}
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
        rows={6}
        maxLength={maxLength}
        placeholder={placeholder ?? 'Escreva a descrição da aula. Use os botões acima para links e formatação.'}
        className="min-h-32 font-mono text-[13px] leading-relaxed"
      />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Aceita Markdown — os botões escrevem a formatação para você.</span>
        <span className="tabular-nums">
          {value.length}/{maxLength}
        </span>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Pré-visualização
        </p>
        {value.trim() ? (
          <MarkdownContent content={value} />
        ) : (
          <p className="text-sm text-muted-foreground/70">
            O que você escrever aparece aqui, do jeito que o cliente verá abaixo do vídeo.
          </p>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 px-2.5"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
      <span className="text-xs">{label}</span>
    </Button>
  );
}
