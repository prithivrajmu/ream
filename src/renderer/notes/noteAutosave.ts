import { NoteConflictError } from "../../shared/noteConflict";
import { clearNoteRecoveryDraft, readNoteRecoveryDraft, writeNoteRecoveryDraft } from "./noteDrafts";

export type SaveStatus = "idle" | "saving" | "saved" | "failed" | "conflict";
export type ConflictChoice = "mine" | "saved" | "both";

/** One queue per document; compare against the last version this editor observed. */
export function createNoteAutosave(contextId: string, storage: Storage, save: (value: string, expectedValue: string) => Promise<unknown>, owner?: string) {
  const recoveryContext = owner ? `${contextId}:window:${owner}` : contextId;
  let recovery = readNoteRecoveryDraft(storage, recoveryContext);
  if (!recovery) {
    const shared = owner ? readNoteRecoveryDraft(storage, contextId) : null;
    const legacy = contextId.startsWith("timer:") ? readNoteRecoveryDraft(storage, "active") : null;
    const matchingLegacy = legacy && Date.parse(legacy.updatedAt) >= Date.parse(contextId.slice(6)) ? legacy : null;
    const previous = shared ?? matchingLegacy;
    if (previous) {
      writeNoteRecoveryDraft(storage, recoveryContext, previous.markdown, previous.updatedAt, previous.baseValue);
      recovery = readNoteRecoveryDraft(storage, recoveryContext);
      if (recovery) clearNoteRecoveryDraft(storage, previous.contextId);
    }
  }
  let baseValue = recovery?.baseValue ?? "";
  let unknownRecoveryBase = Boolean(recovery && recovery.baseValue === undefined);
  let snapshot = { value: recovery?.markdown ?? "", status: (recovery ? "saving" : "idle") as SaveStatus, dirty: Boolean(recovery), conflictValue: null as string | null };
  let revision = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  const writeRecovery = () => writeNoteRecoveryDraft(storage, recoveryContext, snapshot.value, undefined, unknownRecoveryBase ? undefined : baseValue);
  function clearMatchingRecovery(value: string) {
    if (readNoteRecoveryDraft(storage, recoveryContext)?.markdown === value) clearNoteRecoveryDraft(storage, recoveryContext);
  }

  async function drain() {
    while (snapshot.dirty) {
      if (snapshot.conflictValue !== null) throw new NoteConflictError(snapshot.conflictValue);
      const value = snapshot.value;
      const savedRevision = revision;
      snapshot = { ...snapshot, status: "saving" };
      publish();
      try {
        await save(value, baseValue);
        baseValue = value;
        unknownRecoveryBase = false;
        if (revision === savedRevision) {
          clearMatchingRecovery(value);
          snapshot = { value, status: "saved", dirty: false, conflictValue: null };
          publish();
        } else {
          // Newer typing must recover against the write that just succeeded.
          writeRecovery();
        }
      } catch (error) {
        snapshot = { ...snapshot, status: error instanceof NoteConflictError ? "conflict" : "failed", conflictValue: error instanceof NoteConflictError ? error.savedValue : null };
        publish();
        throw error;
      }
    }
  }

  function flush(): Promise<void> {
    clearTimeout(timeout);
    if (!pending) pending = drain().finally(() => { pending = undefined; });
    return pending;
  }

  function change(value: string) {
    if (value === snapshot.value) return;
    revision += 1;
    snapshot = { ...snapshot, value, status: snapshot.conflictValue === null ? "saving" : "conflict", dirty: true };
    writeRecovery();
    clearTimeout(timeout);
    if (snapshot.conflictValue === null) timeout = setTimeout(() => { void flush().catch(() => undefined); }, 500);
    publish();
  }

  async function resolveConflict(choice: ConflictChoice) {
    await pending?.catch(() => undefined);
    if (snapshot.conflictValue === null) return;
    baseValue = snapshot.conflictValue;
    unknownRecoveryBase = false;
    if (choice === "saved") {
      clearMatchingRecovery(snapshot.value);
      snapshot = { value: baseValue, status: "saved", dirty: false, conflictValue: null };
      publish();
      return;
    }
    const value = choice === "both" && baseValue && snapshot.value && baseValue !== snapshot.value
      ? `${baseValue}\n\n---\n\n${snapshot.value}`
      : choice === "both" ? baseValue || snapshot.value : snapshot.value;
    revision += 1;
    snapshot = { value, status: "saving", dirty: true, conflictValue: null };
    writeRecovery();
    publish();
    // Another change while reviewing must raise a new conflict, not be overwritten.
    await flush();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    sync(value: string) {
      if (snapshot.dirty) {
        if (unknownRecoveryBase || snapshot.conflictValue !== null) {
          snapshot = { ...snapshot, status: "conflict", conflictValue: value };
          publish();
        }
        return;
      }
      baseValue = value;
      if (snapshot.value !== value) {
        snapshot = { value, status: value ? "saved" : "idle", dirty: false, conflictValue: null };
        publish();
      }
    },
    change,
    flush,
    resolveConflict
  };
}
