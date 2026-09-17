export interface NoteRecoveryDraft {
  contextId: string;
  markdown: string;
  updatedAt: string;
  baseValue?: string;
}

const NOTE_DRAFT_PREFIX = "ream.noteDraft.";
const draftListeners = new Set<() => void>();

export function subscribeNoteRecoveryDrafts(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => { draftListeners.delete(listener); };
}

export function listNoteRecoveryDrafts(storage: Storage): NoteRecoveryDraft[] {
  const drafts: NoteRecoveryDraft[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(NOTE_DRAFT_PREFIX)) continue;
    const draft = readNoteRecoveryDraft(storage, key.slice(NOTE_DRAFT_PREFIX.length));
    if (draft) drafts.push(draft);
  }
  return drafts.sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0) || left.contextId.localeCompare(right.contextId));
}

export function describeNoteRecoveryDraft(draft: NoteRecoveryDraft) {
  const context = draft.contextId.replace(/:window:(main|overlay)$/, "");
  const owner = draft.contextId.endsWith(":window:overlay") ? "Overlay" : draft.contextId.endsWith(":window:main") ? "Workspace" : "Older draft";
  if (context.startsWith("timer:")) {
    const startedAt = context.slice(6);
    return { label: `Timer started ${Number.isFinite(Date.parse(startedAt)) ? new Date(startedAt).toLocaleString() : startedAt || "at an unknown time"}`, owner, timerStartedAt: startedAt };
  }
  const journal = /^(?:workspace:(\d+):)?journal:(\d{4}-\d{2}-\d{2})$/.exec(context);
  if (journal) return { label: `Journal ${journal[2]}${journal[1] ? ` · workspace version ${journal[1]}` : ""}`, owner, timerStartedAt: null };
  return { label: context === "active" ? "Older timer note" : `Note ${context}`, owner, timerStartedAt: context === "active" ? "legacy" : null };
}

export function isRetainedTimerDraft(draft: NoteRecoveryDraft, activeStartedAt: string | undefined): boolean {
  const { timerStartedAt } = describeNoteRecoveryDraft(draft);
  return timerStartedAt !== null && timerStartedAt !== activeStartedAt;
}

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
      updatedAt: parsedDraft.updatedAt,
      ...(typeof parsedDraft.baseValue === "string" ? { baseValue: parsedDraft.baseValue } : {})
    };
  } catch {
    return null;
  }
}

export function writeNoteRecoveryDraft(storage: Storage, contextId: string | null | undefined, markdown: string, updatedAt = new Date().toISOString(), baseValue?: string): void {
  const key = getNoteDraftKey(contextId);
  if (!key) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify({ contextId, markdown, updatedAt, baseValue }));
    draftListeners.forEach((listener) => listener());
  } catch {
    // Recovery storage can be full; still let the IndexedDB save proceed.
  }
}

export function clearNoteRecoveryDraft(storage: Storage, contextId: string | null | undefined): void {
  const key = getNoteDraftKey(contextId);
  if (!key) {
    return;
  }

  try {
    storage.removeItem(key);
    draftListeners.forEach((listener) => listener());
  } catch {
    // An unavailable recovery store must not turn a successful save into a failure.
  }
}
