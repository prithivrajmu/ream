export class NoteConflictError extends Error {
  constructor(public readonly savedValue: string) {
    super("This note changed in another window. Review both versions before saving.");
    this.name = "NoteConflictError";
  }
}

/** Compare inside the same transaction as the write, not in the renderer. */
export function assertNoteUnchanged(current: string, expected: string | undefined, next: string): void {
  if (expected !== undefined && current !== expected && current !== next) {
    throw new NoteConflictError(current);
  }
}
