import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyDatabase, ReamDatabase } from "../shared/db";
import { createNoteAiSuggestion } from "../shared/aiSuggestionRepository";
import { createProject } from "../shared/projectRepository";
import { createTask } from "../shared/taskRepository";
import { createTimeEntry } from "../shared/timerRepository";
import { createJournalRecap, saveJournalPage } from "../shared/journalRepository";

const databases: ReamDatabase[] = [];

function createTestDatabase(name: string): ReamDatabase {
  const database = new ReamDatabase(name);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("Ream database migration", () => {
  it("copies legacy tasks, entries, notes, and AI suggestions into an empty Ream database", async () => {
    const id = crypto.randomUUID();
    const legacyDatabase = createTestDatabase(`timesheet-tracker-${id}`);
    const reamDatabase = createTestDatabase(`ream-${id}`);
    const project = await createProject(legacyDatabase, { title: "Client work" });
    const task = await createTask(legacyDatabase, { title: "Release testing", projectIds: [project.id] });
    const entry = await createTimeEntry(legacyDatabase, {
      taskId: task.id,
      startedAt: "2026-06-29T09:00:00.000Z",
      endedAt: "2026-06-29T10:00:00.000Z",
      note: "Verified old notes survive the release"
    });
    const suggestion = await createNoteAiSuggestion(legacyDatabase, {
      noteId: entry.id,
      model: "llama3.2:3b",
      inputText: entry.note,
      outputJson: {
        clean_note: "Verified old notes survive the release.",
        summary: "Release persistence check",
        next_steps: [],
        blockers: [],
        tags: ["release"]
      },
      durationMs: 125
    });
    const journalPage = await saveJournalPage(legacyDatabase, "2026-06-29", "Legacy journal thought");
    const journalRecap = await createJournalRecap(legacyDatabase, {
      journalDateKey: "2026-06-30",
      sourceStartDateKey: "2026-06-29",
      sourceEndDateKey: "2026-06-29",
      markdown: "## Recap\n\nLegacy recap",
      model: "llama3.2:3b"
    });

    await expect(migrateLegacyDatabase(reamDatabase, legacyDatabase.name)).resolves.toBe(true);

    await expect(reamDatabase.tasks.toArray()).resolves.toEqual([task]);
    await expect(reamDatabase.projects.toArray()).resolves.toEqual([project]);
    await expect(reamDatabase.timeEntries.toArray()).resolves.toEqual([entry]);
    await expect(reamDatabase.noteAiSuggestions.toArray()).resolves.toEqual([suggestion]);
    await expect(reamDatabase.journalPages.toArray()).resolves.toEqual(expect.arrayContaining([journalPage, expect.objectContaining({ id: journalRecap.journalPageId })]));
    await expect(reamDatabase.journalRecaps.toArray()).resolves.toEqual([journalRecap]);
  });

  it("does not overwrite an existing Ream database", async () => {
    const id = crypto.randomUUID();
    const legacyDatabase = createTestDatabase(`timesheet-tracker-${id}`);
    const reamDatabase = createTestDatabase(`ream-${id}`);
    await createTask(legacyDatabase, { title: "Legacy task" });
    const existingTask = await createTask(reamDatabase, { title: "Current task" });

    await expect(migrateLegacyDatabase(reamDatabase, legacyDatabase.name)).resolves.toBe(false);
    await expect(reamDatabase.tasks.toArray()).resolves.toEqual([existingTask]);
  });
});
