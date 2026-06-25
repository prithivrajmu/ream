import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { TimesheetDatabase } from "../shared/db";
import { importTimesheetData, readAllExportData } from "../shared/exportRepository";
import { buildDailySummaries, buildTaskTotals, entriesToCsv, parseTimesheetExport, serializeTimesheetExport } from "../shared/reporting";
import { createTask } from "../shared/taskRepository";
import { startTimer, stopTimer, updateActiveTimerNote } from "../shared/timerRepository";

const databases: TimesheetDatabase[] = [];

function createTestDatabase(): TimesheetDatabase {
  const database = new TimesheetDatabase(`timesheet-smoke-test-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("timesheet smoke workflow", () => {
  it("tracks work, exports it, and imports it into a clean database", async () => {
    const sourceDb = createTestDatabase();
    const task = await createTask(sourceDb, {
      title: "Zoom planning call",
      project: "Product",
      tags: ["meeting"],
      defaultNote: "Discuss next stage"
    });

    await startTimer(sourceDb, { taskId: task.id }, new Date("2026-06-25T09:00:00.000Z"));
    await updateActiveTimerNote(sourceDb, "Captured decisions from the call", new Date("2026-06-25T09:10:00.000Z"));
    const entry = await stopTimer(sourceDb, new Date("2026-06-25T09:45:00.000Z"));

    const exportData = await readAllExportData(sourceDb);
    const parsedExport = parseTimesheetExport(serializeTimesheetExport(exportData));
    const csv = entriesToCsv(parsedExport.timeEntries, parsedExport.tasks);
    const dailySummaries = buildDailySummaries(parsedExport.timeEntries);
    const taskTotals = buildTaskTotals(parsedExport.timeEntries, parsedExport.tasks);

    expect(entry.durationSeconds).toBe(2700);
    expect(csv).toContain("Zoom planning call,Product");
    expect(dailySummaries).toEqual([{ date: "2026-06-25", durationSeconds: 2700, entryCount: 1 }]);
    expect(taskTotals[0]).toMatchObject({ taskTitle: "Zoom planning call", durationSeconds: 2700 });

    const targetDb = createTestDatabase();
    await importTimesheetData(targetDb, parsedExport);

    await expect(targetDb.tasks.toArray()).resolves.toHaveLength(1);
    await expect(targetDb.timeEntries.toArray()).resolves.toHaveLength(1);
  });
});
