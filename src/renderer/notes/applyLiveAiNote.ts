import type { createNoteAutosave } from "./noteAutosave";

type LiveDraft = Pick<ReturnType<typeof createNoteAutosave>, "flush" | "getSnapshot" | "sync">;

export function isLiveAiPreviewStale(source: string, output: string, localNote: string, savedNote: string, sessionChanged: boolean): boolean {
  const matches = (note: string) => note === source || note === output;
  return sessionChanged || !matches(localNote) || !matches(savedNote);
}

/** Never stage AI output in autosave: a failed atomic commit must not retry as a normal edit. */
export async function applyLiveAiNote<T extends { timer: { note: string } }>(
  draft: LiveDraft,
  source: string,
  output: string,
  commit: () => Promise<T>
): Promise<T> {
  await draft.flush();
  const current = draft.getSnapshot();
  if (current.dirty || current.conflictValue !== null || (current.value !== source && current.value !== output)) {
    throw new Error("Your live note changed. Generate a new suggestion or copy this suggestion to combine the changes yourself.");
  }
  const result = await commit();
  // sync only replaces a clean draft. Typing during the transaction remains a
  // recoverable local edit; its next compare-and-save will detect the AI change.
  draft.sync(result.timer.note);
  return result;
}
