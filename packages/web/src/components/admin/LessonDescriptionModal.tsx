import { useEffect, useState } from 'react';
import { MarkdownEditor } from '@/components/admin/MarkdownEditor';
import { Button } from '@/components/ui/button';
import { Modal, ModalContent } from '@/components/ui/modal';

/**
 * Writing (or clearing) a lesson's description — the text shown below the video.
 *
 * Controlled by the lesson row, mirroring `LessonVideoModal`: the row owns the
 * save mutation and passes `pending` in, this collects the Markdown and hands
 * it back on save. An empty box saves `null`, so "delete everything and save"
 * clears the description rather than storing a blank string. The draft resets to
 * the stored value each time the modal opens, so cancelling truly discards.
 */
export function LessonDescriptionModal({
  open,
  onOpenChange,
  lessonTitle,
  currentDescription,
  onSave,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lessonTitle: string;
  currentDescription: string | null;
  onSave: (description: string | null) => void;
  pending?: boolean;
}) {
  const [draft, setDraft] = useState(currentDescription ?? '');

  // Re-seed the draft whenever the modal opens, so it always starts from what
  // is stored and a cancelled edit leaves nothing behind.
  useEffect(() => {
    if (open) setDraft(currentDescription ?? '');
  }, [open, currentDescription]);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title="Descrição da aula"
        description={`Aparece abaixo do vídeo em "${lessonTitle}".`}
        className="max-w-2xl"
      >
        <MarkdownEditor value={draft} onChange={setDraft} maxLength={2000} />

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button loading={pending} onClick={() => onSave(draft.trim() === '' ? null : draft)}>
            Salvar descrição
          </Button>
        </div>
      </ModalContent>
    </Modal>
  );
}
