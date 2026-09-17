import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReamDatabase } from "../shared/db";
import { createTask } from "../shared/taskRepository";
import { getActiveTimer, startTimer, updateActiveTimerNote } from "../shared/timerRepository";
import { acceptActiveTimerAiSuggestion, createActiveTimerAiSuggestion, updateNoteAiSuggestionStatus } from "../shared/aiSuggestionRepository";
import { formatImprovedNoteMarkdown } from "../shared/ai";
import { createNoteAutosave } from "../renderer/notes/noteAutosave";
import { applyLiveAiNote, isLiveAiPreviewStale } from "../renderer/notes/applyLiveAiNote";
import { readNoteRecoveryDraft } from "../renderer/notes/noteDrafts";
import { NoteConflictError } from "../shared/noteConflict";

const databases: ReamDatabase[] = [];
function storage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, clear: () => data.clear(), key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}
async function setup() {
  const db = new ReamDatabase(`ream-apply-live-${crypto.randomUUID()}`);
  databases.push(db);
  const task = await createTask(db, { title: "Review" });
  const timer = await startTimer(db, { taskId: task.id, note: "Original" });
  const output = { clean_note: "Cleaned note", summary: "Summary", next_steps: [], blockers: [], tags: [] };
  const session = { startedAt: timer.startedAt, workspaceRevision: 0 };
  const suggestion = await createActiveTimerAiSuggestion(db, { model: "synthetic", inputText: timer.note, outputJson: output, durationMs: 1 }, session);
  const localStorage = storage();
  const draft = createNoteAutosave(`timer:${timer.startedAt}`, localStorage, (value, expected) => updateActiveTimerNote(db, value, new Date(), timer.startedAt, expected), "overlay");
  draft.sync(timer.note);
  const formatted = formatImprovedNoteMarkdown(output);
  const commit = () => acceptActiveTimerAiSuggestion(db, suggestion.id, session);
  return { db, timer, suggestion, draft, localStorage, formatted, commit };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe("overlay AI and local autosave handoff", () => {
  it("updates a clean editor only after the atomic commit succeeds", async () => {
    const { db, draft, formatted, commit } = await setup();
    await applyLiveAiNote(draft, "Original", formatted, commit);
    expect(draft.getSnapshot()).toMatchObject({ value: formatted, dirty: false, status: "saved" });
    expect((await getActiveTimer(db))?.note).toBe(formatted);
  });

  it("flushes new local typing but refuses to replace it with an old suggestion", async () => {
    const { db, draft, formatted, commit } = await setup();
    draft.change("New local text");
    const apply = vi.fn(commit);
    await expect(applyLiveAiNote(draft, "Original", formatted, apply)).rejects.toThrow("live note changed");
    expect(apply).not.toHaveBeenCalled();
    expect((await getActiveTimer(db))?.note).toBe("New local text");
    expect(draft.getSnapshot().value).toBe("New local text");
  });

  it("does not stage or retry AI output through autosave after a failed acceptance record", async () => {
    const { db, draft, formatted, commit, suggestion, localStorage } = await setup();
    vi.spyOn(db.noteAiSuggestions, "put").mockRejectedValueOnce(new Error("Disk full"));
    await expect(applyLiveAiNote(draft, "Original", formatted, commit)).rejects.toThrow("Disk full");
    expect(draft.getSnapshot()).toMatchObject({ value: "Original", dirty: false });
    await draft.flush();
    expect((await getActiveTimer(db))?.note).toBe("Original");
    expect((await db.noteAiSuggestions.get(suggestion.id))?.status).toBe("pending");
    expect(localStorage.length).toBe(0);
  });

  it("retains typing during acceptance, including its recovery draft, for conflict review", async () => {
    const { db, timer, draft, formatted, commit, localStorage } = await setup();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const pending = applyLiveAiNote(draft, "Original", formatted, async () => {
      entered();
      await new Promise<void>((resolve) => { release = resolve; });
      return commit();
    });
    await started;
    draft.change("Typed while accepting");
    release();
    await pending;
    expect(draft.getSnapshot()).toMatchObject({ value: "Typed while accepting", dirty: true });
    await expect(draft.flush()).rejects.toBeInstanceOf(NoteConflictError);
    expect((await getActiveTimer(db))?.note).toBe(formatted);
    expect(readNoteRecoveryDraft(localStorage, `timer:${timer.startedAt}:window:overlay`)).toMatchObject({ markdown: "Typed while accepting", baseValue: "Original" });
    expect(draft.getSnapshot().conflictValue).toBe(formatted);
  });

  it("does not apply when flushing the local draft fails or conflicts", async () => {
    const { db, draft, formatted, commit } = await setup();
    draft.change("Unsaved local");
    await updateActiveTimerNote(db, "Workspace edit");
    const apply = vi.fn(commit);
    await expect(applyLiveAiNote(draft, "Original", formatted, apply)).rejects.toBeInstanceOf(NoteConflictError);
    expect(apply).not.toHaveBeenCalled();
    expect(draft.getSnapshot().value).toBe("Unsaved local");
  });

  it("rejects status-only acceptance for live suggestions", async () => {
    const { db, suggestion } = await setup();
    await expect(updateNoteAiSuggestionStatus(db, suggestion.id, "accepted")).rejects.toThrow("atomic");
  });

  it("marks previews stale for local changes, remote changes, and different sessions", () => {
    expect(isLiveAiPreviewStale("source", "output", "source", "source", false)).toBe(false);
    expect(isLiveAiPreviewStale("source", "output", "output", "output", false)).toBe(false);
    expect(isLiveAiPreviewStale("source", "output", "", "source", false)).toBe(true);
    expect(isLiveAiPreviewStale("source", "output", "source", "remote", false)).toBe(true);
    expect(isLiveAiPreviewStale("source", "output", "source", "source", true)).toBe(true);
  });
});
