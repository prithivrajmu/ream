import { useState } from "react";
import type { ConflictChoice } from "./noteAutosave";

export function NoteConflictNotice({ localValue, savedValue, onResolve }: {
  localValue: string;
  savedValue: string | null;
  onResolve: (choice: ConflictChoice) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (savedValue === null) return null;
  async function resolve(choice: ConflictChoice) {
    if (busy) return;
    setBusy(true);
    try {
      await onResolve(choice);
    } catch {
      // The autosave controller reports save errors and any newer conflict.
    } finally {
      setBusy(false);
    }
  }
  return <section className="note-conflict-notice" aria-label="Resolve note conflict">
    <p role="alert"><strong>Two versions of this note need review.</strong> Your edit has not replaced the saved version.</p>
    <div className="note-conflict-versions">
      <div><h3>Saved version</h3><pre tabIndex={0}>{savedValue || "(Empty note)"}</pre></div>
      <div><h3>Your version</h3><pre tabIndex={0}>{localValue || "(Empty note)"}</pre></div>
    </div>
    <p>Keep both adds your version after the saved text. Use saved discards your edit; save mine replaces the saved text.</p>
    <div className="note-conflict-actions">
      <button disabled={busy} onClick={() => void resolve("both")} type="button">Keep both versions</button>
      <button disabled={busy} onClick={() => void resolve("saved")} type="button">Use saved version</button>
      <button disabled={busy} onClick={() => void resolve("mine")} type="button">Save my version</button>
    </div>
  </section>;
}
