export interface NoteRecoveryDraft {
  contextId: string;
  markdown: string;
  updatedAt: string;
}

const NOTE_DRAFT_PREFIX = "ream.noteDraft.";

export function getNoteDraftKey(contextId: string | null | undefined): string | null {
  const normalizedContextId = contextId?.trim();
  return normalizedContextId ? `${NOTE_DRAFT_PREFIX}${normalizedContextId}` : null;
}

export function readNoteRecoveryDraft(storage: Storage, contextId: string | null | undefined): NoteRecoveryDraft | null {
  const key = getNoteDraftKey(contextId);
  if (!key) {
    return null;
  }

  try {
    const rawDraft = storage.getItem(key);
    if (!rawDraft) {
      return null;
    }

    const parsedDraft = JSON.parse(rawDraft) as Partial<NoteRecoveryDraft>;
    const parsedContextId = parsedDraft.contextId;
    if (typeof parsedContextId !== "string" || parsedContextId !== contextId || typeof parsedDraft.markdown !== "string" || typeof parsedDraft.updatedAt !== "string") {
      return null;
    }

    return {
      contextId: parsedContextId,
      markdown: parsedDraft.markdown,
      updatedAt: parsedDraft.updatedAt
    };
  } catch {
    return null;
  }
}

export function writeNoteRecoveryDraft(storage: Storage, contextId: string | null | undefined, markdown: string, updatedAt = new Date().toISOString()): void {
  const key = getNoteDraftKey(contextId);
  if (!key) {
    return;
  }

  storage.setItem(key, JSON.stringify({ contextId, markdown, updatedAt }));
}

export function clearNoteRecoveryDraft(storage: Storage, contextId: string | null | undefined): void {
  const key = getNoteDraftKey(contextId);
  if (!key) {
    return;
  }

  storage.removeItem(key);
}
