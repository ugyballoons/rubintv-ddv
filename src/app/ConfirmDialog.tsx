import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** A yes/no question in the app's own dialog style. Escape and the backdrop cancel. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => confirm.current?.focus(), []);
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog confirm-dialog"
        role="alertdialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="buttons">
          <button onClick={onCancel}>Cancel</button>
          <button ref={confirm} className={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
