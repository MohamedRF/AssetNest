import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from '../../lib/utils';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** Element to receive focus when the dialog opens. Defaults to the dialog frame. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * Modal dialog shell built on the native <dialog> element.
 * `showModal()` gives us the top layer, ::backdrop, Escape-to-close and
 * aria-modal semantics for free. Focus returns to the previously focused
 * element when closed.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!dialog.open) dialog.showModal();
      const target = initialFocusRef?.current ?? dialog;
      target.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, initialFocusRef]);

  useEffect(() => {
    // Restore focus to the trigger when the dialog fully closes.
    if (!open && restoreFocusRef.current) {
      restoreFocusRef.current.focus();
      restoreFocusRef.current = null;
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby={titleId}
      {...(description !== undefined ? { 'aria-describedby': descriptionId } : {})}
      onClose={onClose}
      onClick={(event) => {
        // Backdrop click lands on the <dialog> element itself.
        if (event.target === dialogRef.current) onClose();
      }}
      className={cn(
        'm-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-stone-950/55',
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1.5">
          <h2 id={titleId} className="text-lg leading-6 font-semibold tracking-tight">
            {title}
          </h2>
          {description !== undefined && (
            <p id={descriptionId} className="text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {children !== undefined && children !== null && <div className="text-sm leading-6">{children}</div>}
        {footer !== undefined && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
        )}
      </div>
    </dialog>
  );
}
