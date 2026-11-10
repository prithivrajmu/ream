import { formatImprovedNoteMarkdown, type ImprovedNoteOutput } from "../../shared/ai";
import { RichNoteView } from "../richNotes";
import { isLiveAiPreviewStale } from "./applyLiveAiNote";

export function LiveAiNotePreview({ rawNote, output, model, localNote, savedNote, sessionChanged, busy, onAccept, onCopy, onReject, onRegenerate }: {
  rawNote: string;
  output: ImprovedNoteOutput;
  model: string;
  localNote: string;
  savedNote: string;
  sessionChanged: boolean;
  busy: boolean;
  onAccept: () => void;
  onCopy: () => void;
  onReject: () => void;
  onRegenerate: () => void;
}) {
  const stale = isLiveAiPreviewStale(rawNote, formatImprovedNoteMarkdown(output), localNote, savedNote, sessionChanged);
  return <section className="live-ai-note-preview" aria-label="Review live note suggestion">
    {stale ? <section className="note-conflict-notice" aria-label="Live suggestion needs review">
      <p role="alert"><strong>{sessionChanged ? "The timer or workspace changed." : "Your live note changed after this suggestion was requested."}</strong> Accept is disabled. Keep your newer edits, copy this suggestion to combine them yourself, or regenerate from the current note.</p>
      <div className="note-conflict-versions">
        <div><h3>Current editor text</h3><pre tabIndex={0}>{localNote || "(Empty note)"}</pre></div>
        {savedNote !== localNote ? <div><h3>Current saved note</h3><pre tabIndex={0}>{savedNote || "(Empty note)"}</pre></div> : null}
      </div>
    </section> : null}
    <div className="reference-ai-preview">
      <section className="reference-ai-preview-panel"><h3>Original source note</h3><div className="reference-ai-preview-body"><RichNoteView text={rawNote} /></div></section>
      <section className="reference-ai-preview-panel is-suggestion"><h3>AI suggestion</h3>
        <div className="reference-ai-preview-body"><RichNoteView text={output.clean_note} /><dl>
          <div><dt>Summary</dt><dd>{output.summary}</dd></div>
          <div><dt>Next steps</dt><dd>{output.next_steps.length ? output.next_steps.join("; ") : "None"}</dd></div>
          <div><dt>Blockers</dt><dd>{output.blockers.length ? output.blockers.join("; ") : "None"}</dd></div>
          <div><dt>Tags</dt><dd>{output.tags.length ? output.tags.join(", ") : "None"}</dd></div>
        </dl><small>Model: {model}</small></div>
        <div className="reference-ai-actions">
          <button disabled={busy || stale} onClick={onAccept} type="button">Accept</button>
          <button disabled={busy} onClick={onCopy} type="button">Copy suggestion</button>
          <button disabled={busy} onClick={onReject} type="button">Reject</button>
          {stale && !sessionChanged && localNote.trim() ? <button disabled={busy} onClick={onRegenerate} type="button">Regenerate from current note</button> : null}
        </div>
      </section>
    </div>
    {busy ? <p role="status">Working on your AI request… You can keep editing.</p> : null}
  </section>;
}
