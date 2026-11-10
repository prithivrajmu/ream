import { afterEach, describe, expect, it, vi } from "vitest";
import { createNoteAutosave } from "../renderer/notes/noteAutosave";
import { readNoteRecoveryDraft, writeNoteRecoveryDraft } from "../renderer/notes/noteDrafts";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
}

afterEach(() => vi.useRealTimers());

describe("note autosave", () => {
  it("recovers old-format timer drafts only for the matching session", async () => {
    const storage = memoryStorage();
    const save = vi.fn().mockResolvedValue(undefined);
    writeNoteRecoveryDraft(storage, "active", "recover me", "2026-09-14T09:05:00.000Z");
    const later = createNoteAutosave("timer:2026-09-14T10:00:00.000Z", storage, save);
    expect(later.getSnapshot().dirty).toBe(false);
    const matching = createNoteAutosave("timer:2026-09-14T09:00:00.000Z", storage, save);
    expect(matching.getSnapshot().value).toBe("recover me");
    await matching.flush();
    expect(readNoteRecoveryDraft(storage, "active")).toBeNull();
  });

  it("keeps typing across a background refresh and recovers before the debounce", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const save = vi.fn().mockResolvedValue(undefined);
    const note = createNoteAutosave("timer:session-one", storage, save);
    note.sync("old note");
    note.change("new note still being typed");
    note.sync("old note");
    expect(note.getSnapshot().value).toBe("new note still being typed");
    expect(readNoteRecoveryDraft(storage, "timer:session-one")?.markdown).toBe("new note still being typed");
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledExactlyOnceWith("new note still being typed", "old note");
    expect(note.getSnapshot()).toMatchObject({ dirty: false, status: "saved" });
  });

  it("serializes edits typed during a save and retains their recovery draft", async () => {
    const storage = memoryStorage();
    let finishFirst!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; })).mockResolvedValue(undefined);
    const note = createNoteAutosave("journal:first", storage, save);
    note.change("first version");
    const pending = note.flush();
    note.change("second version");
    expect(save).toHaveBeenCalledTimes(1);
    expect(readNoteRecoveryDraft(storage, "journal:first")?.markdown).toBe("second version");
    finishFirst();
    await pending;
    expect(save.mock.calls.map(([value]) => value)).toEqual(["first version", "second version"]);
    expect(note.getSnapshot()).toMatchObject({ value: "second version", dirty: false, status: "saved" });
    await note.flush();
  });

  it("flushes the original journal date while the next date loads independently", async () => {
    const storage = memoryStorage();
    const firstSave = vi.fn().mockResolvedValue(undefined);
    const nextSave = vi.fn().mockResolvedValue(undefined);
    const first = createNoteAutosave("journal:2026-09-14", storage, firstSave);
    first.change("Monday's notes");
    const flush = first.flush();
    const next = createNoteAutosave("journal:2026-09-15", storage, nextSave);
    next.sync("Tuesday's notes");
    await flush;
    expect(firstSave).toHaveBeenCalledExactlyOnceWith("Monday's notes", "");
    expect(nextSave).not.toHaveBeenCalled();
    expect(next.getSnapshot().value).toBe("Tuesday's notes");
  });

  it("keeps failed edits for recovery and retries, including an intentionally empty note", async () => {
    const storage = memoryStorage();
    const save = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockResolvedValue(undefined);
    const note = createNoteAutosave("journal:today", storage, save);
    note.sync("delete this text");
    note.change("");
    await expect(note.flush()).rejects.toThrow("Disk full");
    expect(note.getSnapshot()).toMatchObject({ value: "", status: "failed", dirty: true });
    const recovered = createNoteAutosave("journal:today", storage, save);
    recovered.sync("delete this text");
    expect(recovered.getSnapshot().value).toBe("");
    await recovered.flush();
    expect(readNoteRecoveryDraft(storage, "journal:today")).toBeNull();
  });

  it("does not clear another window's newer draft when an earlier write finishes", async () => {
    const storage = memoryStorage();
    const save = vi.fn(async () => { writeNoteRecoveryDraft(storage, "timer:one", "other window edit"); });
    const note = createNoteAutosave("timer:one", storage, save);
    note.change("this window edit");
    await note.flush();
    expect(readNoteRecoveryDraft(storage, "timer:one")?.markdown).toBe("other window edit");
  });

  it("continues saving if local recovery storage is unavailable", async () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error("Quota exceeded"); };
    const save = vi.fn().mockResolvedValue(undefined);
    const note = createNoteAutosave("journal:today", storage, save);
    note.change("still save to the database");
    await note.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith("still save to the database", "");
  });
});
