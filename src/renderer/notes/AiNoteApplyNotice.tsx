export function AiNoteApplyNotice({ currentNote, restored }: { currentNote: string; restored: boolean }) {
  return <section className="note-conflict-notice" aria-label="AI suggestion needs a fresh note">
    <p role="alert"><strong>{restored ? "The workspace was restored." : "The saved note changed after this suggestion was requested."}</strong> This suggestion cannot replace it. Generate a new suggestion from the current note, or copy the suggestion and combine the changes in the entry editor.</p>
    <div className="note-conflict-versions"><div><h3>Current saved note</h3><pre tabIndex={0}>{currentNote || "(Empty note)"}</pre></div></div>
  </section>;
}
