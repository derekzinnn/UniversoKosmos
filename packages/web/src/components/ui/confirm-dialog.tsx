import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';

/**
 * Ask before doing something that cannot be undone, in the product's own
 * dialog rather than the browser's `window.confirm`.
 *
 * `window.confirm` was quick but wrong here: it is the browser chrome, not the
 * app — unstyled, untranslatable in tone, blocking, and jarring next to
 * everything else. This is the same Modal the rest of the app uses, so a
 * destructive action reads as part of the product, and the confirm button can
 * carry the actual verb ("Excluir") rather than a generic OK.
 *
 * Controlled by the caller so the trigger stays wherever it already is — an
 * icon button in a row, say — and only the confirmation is centralised.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  loading = false,
  error = null,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  /** Shown inside the dialog when the action fails, so the reason is not lost
   *  behind the modal on a page-level banner. */
  error?: string | null;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent title={title} description={description} className="max-w-md">
        {error ? (
          <Alert variant="error" className="mb-4">
            {error}
          </Alert>
        ) : null}
        <div className="flex justify-end gap-3">
          <ModalClose asChild>
            <Button type="button" variant="ghost">
              {cancelLabel}
            </Button>
          </ModalClose>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </ModalContent>
    </Modal>
  );
}
