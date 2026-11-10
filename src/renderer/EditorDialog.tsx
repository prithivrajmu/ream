import { type ReactNode, useEffect, useRef } from "react";

export function EditorDialog({ children, labelledBy, onClose, busy, error }: {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  busy: boolean;
  error: string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    return () => dialog?.close();
  }, []);

  return <dialog ref={ref} className="editor-dialog" aria-labelledby={labelledBy} onCancel={(event) => {
    event.preventDefault();
    if (!busy) onClose();
  }}>
    <section className="project-composer">
      {error ? <p className="dashboard-error" role="alert">{error}</p> : null}
      <fieldset className="editor-fields" disabled={busy}>{children}</fieldset>
      {busy ? <p role="status">Saving…</p> : null}
    </section>
  </dialog>;
}
