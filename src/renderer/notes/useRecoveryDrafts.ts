import { useEffect, useState } from "react";
import { listNoteRecoveryDrafts, subscribeNoteRecoveryDrafts, type NoteRecoveryDraft } from "./noteDrafts";

function readDrafts(): { drafts: NoteRecoveryDraft[]; unavailable: boolean } {
  try {
    return { drafts: listNoteRecoveryDrafts(window.localStorage), unavailable: false };
  } catch {
    return { drafts: [], unavailable: true };
  }
}

export function useRecoveryDrafts() {
  const [snapshot, setSnapshot] = useState(readDrafts);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Coalesce typing notifications and avoid state updates during draft migration/render.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setSnapshot(readDrafts()), 150);
    };
    const unsubscribe = subscribeNoteRecoveryDrafts(refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    refresh();
    return () => {
      unsubscribe();
      clearTimeout(timer);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return snapshot;
}
