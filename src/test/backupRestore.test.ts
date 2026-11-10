import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReamDatabase } from "../shared/db";
import { importReamData, readAllExportData } from "../shared/exportRepository";
import { getJournalPage, saveJournalPage } from "../shared/journalRepository";
import { createTask } from "../shared/taskRepository";
import { getActiveTimer, pauseTimer, startTimer } from "../shared/timerRepository";
import { journalDraftContext, readWorkspaceRevision } from "../shared/workspaceRepository";
import { createReamExport, parseReamExport, serializeReamExport } from "../shared/reporting";
import { restoreBackup } from "../renderer/restoreBackup";
import { createNoteAutosave } from "../renderer/notes/noteAutosave";
import { readNoteRecoveryDraft } from "../renderer/notes/noteDrafts";

const databases: ReamDatabase[] = [];
const dateKey = "2026-09-15";
function createDatabase() {
  const database = new ReamDatabase(`ream-restore-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}
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
async function fixture() {
  const source = createDatabase();
  await createTask(source, { title: "Imported task" });
  await saveJournalPage(source, dateKey, "Imported journal");
  const backup = await readAllExportData(source);
  const database = createDatabase();
  const task = await createTask(database, { title: "Existing task" });
  await saveJournalPage(database, dateKey, "Existing journal");
  return { database, task, backup, text: serializeReamExport(backup) };
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("backup restore safety", () => {
  it("cancels before flushing or replacing current data", async () => {
    const { database, task, text } = await fixture();
    const flushPendingNotes = vi.fn();
    await expect(restoreBackup(database, text, { confirmRestore: () => false, flushPendingNotes })).resolves.toBe(false);
    expect(flushPendingNotes).not.toHaveBeenCalled();
    expect(await database.tasks.toArray()).toEqual([task]);
    expect(await readWorkspaceRevision(database)).toBe(0);
  });

  it("aborts on a failed pending save and keeps the draft available for retry", async () => {
    const { database, task, text } = await fixture();
    const storage = memoryStorage();
    const save = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockImplementation((value: string) => saveJournalPage(database, dateKey, value, new Date(), 0));
    const note = createNoteAutosave(journalDraftContext(dateKey, 0), storage, save);
    note.change("Unsaved local edit");
    await expect(restoreBackup(database, text, { confirmRestore: () => true, flushPendingNotes: note.flush })).rejects.toThrow("Disk full");
    expect(await database.tasks.toArray()).toEqual([task]);
    expect(await readWorkspaceRevision(database)).toBe(0);
    expect(readNoteRecoveryDraft(storage, journalDraftContext(dateKey, 0))?.markdown).toBe("Unsaved local edit");
    await note.flush();
    expect((await getJournalPage(database, dateKey))?.markdown).toBe("Unsaved local edit");
  });

  it("flushes pending notes before a confirmed restore and isolates later recovery", async () => {
    const { database, text } = await fixture();
    const storage = memoryStorage();
    const note = createNoteAutosave(journalDraftContext(dateKey, 0), storage, (value) => saveJournalPage(database, dateKey, value, new Date(), 0));
    note.change("Recent local edit");
    await expect(restoreBackup(database, text, { confirmRestore: () => true, flushPendingNotes: note.flush })).resolves.toBe(true);
    expect(note.getSnapshot().dirty).toBe(false);
    expect((await getJournalPage(database, dateKey))?.markdown).toBe("Imported journal");
    expect(await readWorkspaceRevision(database)).toBe(1);
    // An older mounted editor's cleanup or retry must not overwrite the restore.
    note.change("Late local edit");
    await expect(note.flush()).rejects.toThrow("workspace was restored");
    expect((await getJournalPage(database, dateKey))?.markdown).toBe("Imported journal");
    expect(readNoteRecoveryDraft(storage, journalDraftContext(dateKey, 0))?.markdown).toBe("Late local edit");
    const restored = createNoteAutosave(journalDraftContext(dateKey, 1), storage, (value) => saveJournalPage(database, dateKey, value, new Date(), 1));
    restored.sync("Imported journal");
    expect(restored.getSnapshot()).toMatchObject({ value: "Imported journal", dirty: false });
    restored.change("New workspace edit");
    await restored.flush();
    expect((await getJournalPage(database, dateKey))?.markdown).toBe("New workspace edit");
  });

  it("rejects stale writes from a second database connection, including absent dates", async () => {
    const { database, backup } = await fixture();
    const secondWindow = new ReamDatabase(database.name);
    try {
      const oldRevision = await readWorkspaceRevision(secondWindow);
      await importReamData(database, backup);
      await expect(saveJournalPage(secondWindow, "2026-09-14", "Stale draft", new Date(), oldRevision)).rejects.toThrow("workspace was restored");
      expect(await getJournalPage(database, "2026-09-14")).toBeNull();
    } finally {
      secondWindow.close();
    }
  });

  it("rolls back all replacements and the revision when a database write fails", async () => {
    const { database, task, backup } = await fixture();
    const fail = () => { throw new Error("Simulated storage failure"); };
    database.workspaceState.hook("creating", fail);
    await expect(importReamData(database, backup)).rejects.toThrow("Simulated storage failure");
    expect(await database.tasks.toArray()).toEqual([task]);
    expect((await getJournalPage(database, dateKey))?.markdown).toBe("Existing journal");
    expect(await readWorkspaceRevision(database)).toBe(0);
    database.workspaceState.hook("creating").unsubscribe(fail);
    await saveJournalPage(database, dateKey, "Retry local edit", new Date(), 0);
    await importReamData(database, backup);
    expect(await readWorkspaceRevision(database)).toBe(1);
  });

  it.each([false, true])("preserves an active timer when paused=%s", async (paused) => {
    const { database, task, backup } = await fixture();
    await startTimer(database, { taskId: task.id, note: "Keep my session note" });
    if (paused) await pauseTimer(database);
    const timer = await getActiveTimer(database);
    await expect(importReamData(database, backup)).rejects.toThrow("Stop the active timer");
    expect(await getActiveTimer(database)).toEqual(timer);
    expect(await database.tasks.toArray()).toEqual([task]);
  });

  it("rechecks the timer inside the restore transaction", async () => {
    const { database, task, text } = await fixture();
    await expect(restoreBackup(database, text, {
      confirmRestore: () => true,
      flushPendingNotes: () => startTimer(database, { taskId: task.id })
    })).rejects.toThrow("Stop the active timer");
    expect((await getActiveTimer(database))?.taskId).toBe(task.id);
    expect(await readWorkspaceRevision(database)).toBe(0);
  });

  it("rejects malformed and ambiguous backups before asking to replace data", async () => {
    const { database, task, backup } = await fixture();
    const confirmRestore = vi.fn();
    for (const text of ["not-json", JSON.stringify({ ...backup, projects: undefined }), JSON.stringify({ ...backup, tasks: [backup.tasks[0], backup.tasks[0]] })]) {
      await expect(restoreBackup(database, text, { confirmRestore, flushPendingNotes: vi.fn() })).rejects.toThrow("Invalid Ream export file");
    }
    expect(confirmRestore).not.toHaveBeenCalled();
    expect(await database.tasks.toArray()).toEqual([task]);
    expect(() => parseReamExport(JSON.stringify({ ...backup, journalPages: [backup.journalPages[0], { ...backup.journalPages[0], id: "different" }] }))).toThrow("duplicate journal dates");
  });

  it("upgrades a version-7 database without changing its journal", async () => {
    const database = createDatabase();
    const legacy = new Dexie(database.name);
    legacy.version(7).stores({
      tasks: "id, title, *projectIds, archived, createdAt, updatedAt",
      projects: "id, title, archived, createdAt, updatedAt",
      timeEntries: "id, taskId, startedAt, endedAt, createdAt",
      activeTimers: "id, taskId, startedAt",
      noteAiSuggestions: "id, noteId, status, createdAt, statusUpdatedAt, acceptedAt",
      journalPages: "id, &dateKey, createdAt, updatedAt",
      journalRecaps: "id, journalPageId, journalDateKey, [sourceStartDateKey+sourceEndDateKey], createdAt, updatedAt"
    });
    await legacy.table("journalPages").put({ id: "old-page", dateKey, markdown: "Before upgrade", createdAt: "2026-09-15T00:00:00Z", updatedAt: "2026-09-15T00:00:00Z" });
    legacy.close();
    expect((await getJournalPage(database, dateKey))?.markdown).toBe("Before upgrade");
    expect(await readWorkspaceRevision(database)).toBe(0);
    await importReamData(database, createReamExport([], [], []));
    expect(await readWorkspaceRevision(database)).toBe(1);
  });
});
