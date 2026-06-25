import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { TimesheetDatabase } from "../shared/db";
import type { Task, TimeEntry } from "../shared/domain";
import { importTimesheetData, readAllExportData } from "../shared/exportRepository";
import {
  buildDailySummaries,
  buildTaskTotals,
  createTimesheetExport,
  entriesToCsv,
  parseTimesheetExport,
  serializeTimesheetExport
} from "../shared/reporting";

const taskA: Task = {
  id: "task_a",
  title: "Client call",
  project: "Acme",
  tags: ["meeting"],
  defaultNote: "",
  archived: false,
  createdAt: "2026-06-25T08:00:00.000Z",
  updatedAt: "2026-06-25T08:00:00.000Z"
};

const taskB: Task = {
  ...taskA,
  id: "task_b",
  title: "Implementation",
  project: "Internal"
};

const entries: TimeEntry[] = [
  {
    id: "entry_1",
    taskId: "task_a",
    startedAt: "2026-06-25T09:00:00.000Z",
    endedAt: "2026-06-25T09:30:00.000Z",
    durationSeconds: 1800,
    note: "Discussed scope",
    createdAt: "2026-06-25T09:30:00.000Z",
    updatedAt: "2026-06-25T09:30:00.000Z"
  },
  {
    id: "entry_2",
    taskId: "task_b",
    startedAt: "2026-06-25T10:00:00.000Z",
    endedAt: "2026-06-25T11:00:00.000Z",
    durationSeconds: 3600,
    note: "Built export",
    createdAt: "2026-06-25T11:00:00.000Z",
    updatedAt: "2026-06-25T11:00:00.000Z"
  },
  {
    id: "entry_3",
    taskId: "task_b",
    startedAt: "2026-06-24T10:00:00.000Z",
    endedAt: "2026-06-24T10:15:00.000Z",
    durationSeconds: 900,
    note: "Fixed CSV, with comma",
    createdAt: "2026-06-24T10:15:00.000Z",
    updatedAt: "2026-06-24T10:15:00.000Z"
  }
];

let database: TimesheetDatabase | null = null;

function createTestDatabase(): TimesheetDatabase {
  database = new TimesheetDatabase(`timesheet-report-test-${crypto.randomUUID()}`);
  return database;
}

afterEach(async () => {
  if (database) {
    await database.delete();
    database = null;
  }
});

describe("reporting", () => {
  it("builds task totals and daily summaries", () => {
    expect(buildTaskTotals(entries, [taskA, taskB])).toEqual([
      {
        taskId: "task_b",
        taskTitle: "Implementation",
        project: "Internal",
        durationSeconds: 4500,
        entryCount: 2
      },
      {
        taskId: "task_a",
        taskTitle: "Client call",
        project: "Acme",
        durationSeconds: 1800,
        entryCount: 1
      }
    ]);

    expect(buildDailySummaries(entries)).toEqual([
      { date: "2026-06-25", durationSeconds: 5400, entryCount: 2 },
      { date: "2026-06-24", durationSeconds: 900, entryCount: 1 }
    ]);
  });

  it("serializes JSON exports and parses them back", () => {
    const exportData = createTimesheetExport([taskA, taskB], entries, new Date("2026-06-25T12:00:00.000Z"));
    const serialized = serializeTimesheetExport(exportData);

    expect(parseTimesheetExport(serialized)).toEqual(exportData);
    expect(() => parseTimesheetExport("{}" )).toThrow("Invalid timesheet export file.");
  });

  it("formats CSV with escaped notes", () => {
    expect(entriesToCsv(entries, [taskA, taskB])).toContain(
      'Implementation,Internal,2026-06-24T10:00:00.000Z,2026-06-24T10:15:00.000Z,900,0.25,"Fixed CSV, with comma"'
    );
  });

  it("imports exported data into a clean database", async () => {
    const sourceDb = createTestDatabase();
    await sourceDb.tasks.bulkPut([taskA, taskB]);
    await sourceDb.timeEntries.bulkPut(entries);

    const exportData = await readAllExportData(sourceDb);
    await sourceDb.delete();

    const targetDb = createTestDatabase();
    await importTimesheetData(targetDb, exportData);

    await expect(targetDb.tasks.toArray()).resolves.toHaveLength(2);
    await expect(targetDb.timeEntries.toArray()).resolves.toHaveLength(3);
    await expect(targetDb.activeTimers.toArray()).resolves.toEqual([]);
  });
});
