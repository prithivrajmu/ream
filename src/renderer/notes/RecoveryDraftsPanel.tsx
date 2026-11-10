import { useState } from "react";
import { downloadTextFile } from "../rendererUtils";
import { describeNoteRecoveryDraft, type NoteRecoveryDraft } from "./noteDrafts";

export function RecoveryDraftsPanel({ drafts, unavailable = false }: { drafts: NoteRecoveryDraft[]; unavailable?: boolean }) {
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; failed: boolean } | null>(null);
  const visible = drafts.filter((draft) => `${describeNoteRecoveryDraft(draft).label} ${draft.markdown} ${draft.baseValue ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  async function copy(draft: NoteRecoveryDraft) {
    try {
      await navigator.clipboard.writeText(draft.markdown);
      setFeedback({ message: "Draft copied. Your saved note has not changed.", failed: false });
    } catch {
      setFeedback({ message: "Clipboard access failed. Select the draft text below and copy it manually, or download a Markdown copy.", failed: true });
    }
  }
  function download(draft: NoteRecoveryDraft) {
    try {
      downloadTextFile(`ream-recovered-${draft.contextId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 140)}.md`, "text/markdown", draft.markdown);
      setFeedback({ message: "Download requested. The recovery draft is still retained here.", failed: false });
    } catch {
      setFeedback({ message: "Unable to download. Select and copy the draft text below.", failed: true });
    }
  }
  return <section className="dashboard-panel recovery-drafts-panel" id="recovery-drafts" aria-label="Recover unsaved notes">
    <h2>Recover unsaved notes</h2>
    <p>These are local recovery copies, including edits from stopped timers and earlier workspaces. Copy or download the text, then paste it into the note you want to keep. Saved entries are never changed here.</p>
    {unavailable ? <p role="alert">Recovery storage is unavailable. Keep any unsaved editors open and try again when local storage is available.</p> : <>
      <label className="recovery-drafts-search">Find a draft<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search dates or note text…" /></label>
      <p>{drafts.length} retained {drafts.length === 1 ? "draft" : "drafts"}. Drafts still being edited may disappear after they save successfully.</p>
      {!drafts.length ? <p>No recovery drafts found.</p> : !visible.length ? <p>No matching drafts. <button type="button" onClick={() => setQuery("")}>Clear search</button></p> : null}
      {feedback ? <p role={feedback.failed ? "alert" : "status"}>{feedback.message}</p> : null}
      {visible.map((draft, index) => {
        const metadata = describeNoteRecoveryDraft(draft);
        const timestamp = Number.isFinite(Date.parse(draft.updatedAt)) ? new Date(draft.updatedAt).toLocaleString() : "Unknown save time";
        return <details className="recovery-draft" key={draft.contextId} open={index === 0}>
          <summary>{metadata.label} · {metadata.owner}<small>Draft saved {timestamp}</small></summary>
          {draft.markdown === "" ? <p>This draft intentionally clears the note.</p> : null}
          <textarea readOnly aria-label={`Recovery text: ${metadata.label} · ${metadata.owner}`} value={draft.markdown} rows={5} spellCheck={false} />
          {draft.baseValue !== undefined ? <details className="recovery-draft-baseline"><summary>Original saved version</summary><pre tabIndex={0}>{draft.baseValue || "(Empty note)"}</pre></details> : null}
          <div className="recovery-draft-actions"><button type="button" onClick={() => void copy(draft)}>Copy draft</button><button type="button" onClick={() => download(draft)}>Download Markdown</button></div>
        </details>;
      })}
    </>}
  </section>;
}
