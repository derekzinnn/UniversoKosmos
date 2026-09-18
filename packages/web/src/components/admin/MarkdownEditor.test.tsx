import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MarkdownEditor } from './MarkdownEditor';

/** A controlled host, since the editor writes back through `onChange`. */
function Harness() {
  const [value, setValue] = useState('');
  return <MarkdownEditor value={value} onChange={setValue} />;
}

describe('MarkdownEditor', () => {
  it('writes the Markdown so the author does not have to type it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const box = screen.getByRole('textbox');

    await user.click(screen.getByRole('button', { name: 'Negrito' }));
    expect(box).toHaveValue('**texto em negrito**');

    await user.clear(box);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(box).toHaveValue('[texto do link](https://)');

    await user.clear(box);
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(box).toHaveValue('- item da lista');
  });

  it('shows a live preview of what the client will see', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole('textbox'), 'Isso é **importante**');

    // The preview renders the Markdown, so the bold word becomes a <strong>.
    expect(screen.getByText('importante').tagName).toBe('STRONG');
  });
});
