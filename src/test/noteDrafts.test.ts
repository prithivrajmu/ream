import { describe, expect, it, vi } from "vitest";
import { clearNoteRecoveryDraft, describeNoteRecoveryDraft, getNoteDraftKey, isRetainedTimerDraft, listNoteRecoveryDrafts, readNoteRecoveryDraft, subscribeNoteRecoveryDrafts, writeNoteRecoveryDraft } from "../renderer/notes/noteDrafts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("note recovery drafts", () => {
  it("lists only valid recovery records, newest first, including intentionally empty edits", () => {
    const storage = new MemoryStorage();
    storage.setItem("unrelated-setting", "private unrelated value");
    storage.setItem("ream.noteDraft.broken", "not-json");
    storage.setItem("ream.noteDraft.mismatch", JSON.stringify({ contextId: "different", markdown: "wrong", updatedAt: "2026-09-16T09:00:00Z" }));
    writeNoteRecoveryDraft(storage, "journal:2026-09-15:window:main", "Earlier draft", "2026-09-15T09:00:00Z");
    writeNoteRecoveryDraft(storage, "timer:2026-09-16T09:00:00Z:window:overlay", "", "2026-09-16T09:05:00Z", "Original saved note");
    const read = vi.spyOn(storage, "getItem");
    expect(listNoteRecoveryDrafts(storage)).toMatchObject([
      { markdown: "", baseValue: "Original saved note" }, { markdown: "Earlier draft" }
    ]);
    expect(read).not.toHaveBeenCalledWith("unrelated-setting");
    expect(storage.length).toBe(5);
  });

  it("identifies ended timer drafts without treating the active session or journals as ended", () => {
    const draft = { contextId: "timer:2026-09-16T09:00:00Z:window:overlay", markdown: "Draft", updatedAt: "2026-09-16T09:05:00Z" };
    expect(isRetainedTimerDraft(draft, "2026-09-16T09:00:00Z")).toBe(false);
    expect(isRetainedTimerDraft(draft, undefined)).toBe(true);
    expect(isRetainedTimerDraft(draft, "2026-09-16T10:00:00Z")).toBe(true);
    expect(isRetainedTimerDraft({ ...draft, contextId: "workspace:2:journal:2026-09-16:window:main" }, undefined)).toBe(false);
    expect(describeNoteRecoveryDraft({ ...draft, contextId: "workspace:2:journal:2026-09-16:window:main" })).toMatchObject({ label: "Journal 2026-09-16 · workspace version 2", owner: "Workspace" });
    expect(describeNoteRecoveryDraft({ ...draft, contextId: "active" }).label).toBe("Older timer note");
  });

  it("notifies local subscribers on writes and clears, and supports cleanup", () => {
    const storage = new MemoryStorage();
    const listener = vi.fn();
    const unsubscribe = subscribeNoteRecoveryDrafts(listener);
    try {
      writeNoteRecoveryDraft(storage, "timer:one", "Draft");
      clearNoteRecoveryDraft(storage, "timer:one");
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
    writeNoteRecoveryDraft(storage, "timer:one", "Another draft");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reports unavailable enumeration instead of claiming no drafts exist", () => {
    const storage = new MemoryStorage();
    Object.defineProperty(storage, "length", { get: () => { throw new Error("Storage unavailable"); } });
    expect(() => listNoteRecoveryDrafts(storage)).toThrow("Storage unavailable");
  });

  it("uses stable draft keys for note contexts", () => {
    expect(getNoteDraftKey("timer_1")).toBe("ream.noteDraft.timer_1");
    expect(getNoteDraftKey(" ")).toBeNull();
  });

  it("writes, reads, and clears a recovery draft", () => {
    const storage = new MemoryStorage();

    writeNoteRecoveryDraft(storage, "timer_1", "## Progress", "2026-07-10T09:00:00.000Z");

    expect(readNoteRecoveryDraft(storage, "timer_1")).toEqual({
      contextId: "timer_1",
      markdown: "## Progress",
      updatedAt: "2026-07-10T09:00:00.000Z"
    });

    clearNoteRecoveryDraft(storage, "timer_1");
    expect(readNoteRecoveryDraft(storage, "timer_1")).toBeNull();
  });

  it("ignores malformed or mismatched drafts", () => {
    const storage = new MemoryStorage();

    storage.setItem("ream.noteDraft.timer_1", JSON.stringify({ contextId: "timer_2", markdown: "wrong", updatedAt: "2026-07-10T09:00:00.000Z" }));
    storage.setItem("ream.noteDraft.timer_3", "{not-json");

    expect(readNoteRecoveryDraft(storage, "timer_1")).toBeNull();
    expect(readNoteRecoveryDraft(storage, "timer_3")).toBeNull();
  });
});
