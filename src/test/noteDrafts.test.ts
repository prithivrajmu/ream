import { describe, expect, it } from "vitest";
import { clearNoteRecoveryDraft, getNoteDraftKey, readNoteRecoveryDraft, writeNoteRecoveryDraft } from "../renderer/notes/noteDrafts";

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
