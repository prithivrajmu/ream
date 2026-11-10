import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ReamDatabase } from "../shared/db";
import { importReamData, readAllExportData } from "../shared/exportRepository";
import { buildDailySummaries, buildTaskTotals, entriesToCsv, parseReamExport, serializeReamExport } from "../shared/reporting";
import { createProject } from "../shared/projectRepository";
import { createTask } from "../shared/taskRepository";
import { startTimer, stopTimer, updateActiveTimerNote } from "../shared/timerRepository";
import { createJournalRecap, saveJournalPage } from "../shared/journalRepository";

const databases: ReamDatabase[] = [];

function createTestDatabase(): ReamDatabase {
  const database = new ReamDatabase(`ream-smoke-test-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("Ream smoke workflow", () => {
  it("tracks work, exports it, and imports it into a clean database", async () => {
    const sourceDb = createTestDatabase();
    const project = await createProject(sourceDb, { title: "Product" });
    const task = await createTask(sourceDb, {
      title: "Zoom planning call",
      projectIds: [project.id],
      tags: ["meeting"],
      defaultNote: "Discuss next stage"
    });

    await startTimer(sourceDb, { taskId: task.id }, new Date("2026-06-25T09:00:00.000Z"));
    await updateActiveTimerNote(sourceDb, "Captured decisions from the call", new Date("2026-06-25T09:10:00.000Z"));
    const entry = await stopTimer(sourceDb, new Date("2026-06-25T09:45:00.000Z"));
    await saveJournalPage(sourceDb, "2026-06-25", "Remember to send the follow-up.");
    await createJournalRecap(sourceDb, {
      journalDateKey: "2026-06-26",
      sourceStartDateKey: "2026-06-25",
      sourceEndDateKey: "2026-06-25",
      markdown: "## Recap\n\n- [ ] Send the follow-up",
      model: "llama3.2:3b"
    });

    const exportData = await readAllExportData(sourceDb);
    const parsedExport = parseReamExport(serializeReamExport(exportData));
    const csv = entriesToCsv(parsedExport.timeEntries, parsedExport.tasks, parsedExport.projects);
    const dailySummaries = buildDailySummaries(parsedExport.timeEntries);
    const taskTotals = buildTaskTotals(parsedExport.timeEntries, parsedExport.tasks);

    expect(entry.durationSeconds).toBe(2700);
    expect(csv).toContain("Zoom planning call,Product");
    expect(dailySummaries).toEqual([{ date: "2026-06-25", durationSeconds: 2700, entryCount: 1 }]);
    expect(taskTotals[0]).toMatchObject({ taskTitle: "Zoom planning call", durationSeconds: 2700 });

    const targetDb = createTestDatabase();
    await importReamData(targetDb, parsedExport);

    await expect(targetDb.tasks.toArray()).resolves.toHaveLength(1);
    await expect(targetDb.projects.toArray()).resolves.toHaveLength(1);
    await expect(targetDb.timeEntries.toArray()).resolves.toHaveLength(1);
    await expect(targetDb.journalPages.toArray()).resolves.toHaveLength(2);
    await expect(targetDb.journalRecaps.toArray()).resolves.toHaveLength(1);
  });
});
