import type { TimeEntry } from "./domain";

export class EntryConflictError extends Error {
  constructor(public readonly savedEntry: TimeEntry) {
    super("This entry changed while you were editing. Review both versions before saving.");
    this.name = "EntryConflictError";
  }
}

/** Compare values, not only updatedAt: two writes can share a timestamp. */
export function assertEntryUnchanged(current: TimeEntry, expected?: TimeEntry): void {
  if (!expected) return;
  const snapshot = (entry: TimeEntry) => JSON.stringify([
    entry.id, entry.taskId, entry.projectIds, entry.startedAt, entry.endedAt,
    entry.durationSeconds, entry.note, entry.createdAt, entry.updatedAt
  ]);
  if (snapshot(current) !== snapshot(expected)) throw new EntryConflictError(current);
}
