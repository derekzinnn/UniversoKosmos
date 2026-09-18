import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from './MarkdownContent';

describe('MarkdownContent', () => {
  it('renders a Markdown link as a safe new-tab anchor', () => {
    render(<MarkdownContent content="Veja o [nosso site](https://kosmos.example.com)." />);

    const link = screen.getByRole('link', { name: 'nosso site' });
    expect(link).toHaveAttribute('href', 'https://kosmos.example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('turns a bare URL into a link (gfm autolink)', () => {
    render(<MarkdownContent content="Acesse https://kosmos.example.com para começar." />);

    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://kosmos.example.com');
  });

  it('renders bold text and bullet lists', () => {
    render(<MarkdownContent content={'Isso é **importante**.\n\n- Primeiro\n- Segundo'} />);

    expect(screen.getByText('importante').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('does not render raw HTML — an injected tag is shown as text, not executed', () => {
    const { container } = render(
      <MarkdownContent content={'<img src=x onerror="alert(1)"> texto seguro'} />,
    );

    // The tag is escaped to text; no real <img> element makes it into the DOM.
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/texto seguro/)).toBeInTheDocument();
  });

  it('drops a javascript: link rather than rendering it as clickable', () => {
    render(<MarkdownContent content="[clique](javascript:alert(1))" />);

    // react-markdown sanitises the URL; the anchor, if any, must not carry it.
    const link = screen.queryByRole('link');
    expect(link?.getAttribute('href') ?? '').not.toContain('javascript:');
  });
});
