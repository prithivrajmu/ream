import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ReamDatabase } from "../shared/db";
import type { Project, Task, TimeEntry } from "../shared/domain";
import { importReamData, readAllExportData } from "../shared/exportRepository";
import {
  buildDailySummaries,
  buildTaskTotals,
  createReamExport,
  entriesToCsv,
  parseReamExport,
  serializeReamExport
} from "../shared/reporting";

const taskA: Task = {
  id: "task_a",
  title: "Client call",
  projectIds: ["project_acme"],
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
  projectIds: ["project_internal"]
};

const projects: Project[] = [
  { id: "project_acme", title: "Acme", archived: false, createdAt: "2026-06-25T08:00:00.000Z", updatedAt: "2026-06-25T08:00:00.000Z" },
  { id: "project_internal", title: "Internal", archived: false, createdAt: "2026-06-25T08:00:00.000Z", updatedAt: "2026-06-25T08:00:00.000Z" }
];

const entries: TimeEntry[] = [
  {
    id: "entry_1",
    taskId: "task_a",
    projectIds: ["project_acme"],
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
    projectIds: ["project_internal"],
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
    projectIds: ["project_internal"],
    startedAt: "2026-06-24T10:00:00.000Z",
    endedAt: "2026-06-24T10:15:00.000Z",
    durationSeconds: 900,
    note: "Fixed CSV, with comma",
    createdAt: "2026-06-24T10:15:00.000Z",
    updatedAt: "2026-06-24T10:15:00.000Z"
  }
];

let database: ReamDatabase | null = null;

function createTestDatabase(): ReamDatabase {
  database = new ReamDatabase(`ream-report-test-${crypto.randomUUID()}`);
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
    expect(buildTaskTotals(entries, [taskA, taskB], projects)).toEqual([
      {
        taskId: "task_b",
        taskTitle: "Implementation",
        projects: ["Internal"],
        durationSeconds: 4500,
        entryCount: 2
      },
      {
        taskId: "task_a",
        taskTitle: "Client call",
        projects: ["Acme"],
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
    const exportData = createReamExport([taskA, taskB], projects, entries, new Date("2026-06-25T12:00:00.000Z"));
    const serialized = serializeReamExport(exportData);

    expect(parseReamExport(serialized)).toEqual(exportData);
    expect(() => parseReamExport("{}" )).toThrow("unsupported schema version");
  });

  it("upgrades a version 1 backup with a single project field", () => {
    const legacyTask = {
      ...taskA,
      project: "Acme",
      projectIds: undefined
    };
    const parsed = parseReamExport(JSON.stringify({
      exportedAt: "2026-06-25T12:00:00.000Z",
      schemaVersion: 1,
      tasks: [legacyTask],
      timeEntries: [entries[0]]
    }));

    expect(parsed.projects).toMatchObject([{ title: "Acme", archived: false }]);
    expect(parsed.tasks[0].projectIds).toEqual([parsed.projects[0].id]);
  });

  it("defaults missing entry projects from the entry task when importing older backups", () => {
    const legacyEntry = { ...entries[0] };
    delete (legacyEntry as Partial<TimeEntry>).projectIds;

    const parsed = parseReamExport(JSON.stringify({
      exportedAt: "2026-06-25T12:00:00.000Z",
      schemaVersion: 2,
      tasks: [taskA],
      projects: [projects[0]],
      timeEntries: [legacyEntry]
    }));

    expect(parsed.timeEntries[0].projectIds).toEqual(["project_acme"]);
  });

  it("rejects malformed imports before restore", () => {
    const exportData = createReamExport([taskA], [projects[0]], [entries[0]], new Date("2026-06-25T12:00:00.000Z"));

    expect(() => parseReamExport("not-json")).toThrow("JSON could not be parsed");
    expect(() => parseReamExport(JSON.stringify({ ...exportData, schemaVersion: 0 }))).toThrow(
      "unsupported schema version"
    );
    expect(() => parseReamExport(JSON.stringify({ ...exportData, tasks: [{ ...taskA, title: 123 }] }))).toThrow(
      "task 1.title must be a string"
    );
    expect(() =>
      parseReamExport(JSON.stringify({ ...exportData, timeEntries: [{ ...entries[0], taskId: "missing" }] }))
    ).toThrow("references an unknown task");
    expect(() =>
      parseReamExport(
        JSON.stringify({
          ...exportData,
          timeEntries: [{ ...entries[0], startedAt: "2026-06-25T10:00:00.000Z", endedAt: "2026-06-25T09:00:00.000Z" }]
        })
      )
    ).toThrow("ends before it starts");
  });

  it("formats CSV with escaped notes", () => {
    expect(entriesToCsv(entries, [taskA, taskB], projects)).toContain(
      'Implementation,Internal,2026-06-24T10:00:00.000Z,2026-06-24T10:15:00.000Z,900,0.25,"Fixed CSV, with comma"'
    );
  });

  it("imports exported data into a clean database", async () => {
    const sourceDb = createTestDatabase();
    await sourceDb.tasks.bulkPut([taskA, taskB]);
    await sourceDb.projects.bulkPut(projects);
    await sourceDb.timeEntries.bulkPut(entries);

    const exportData = await readAllExportData(sourceDb);
    await sourceDb.delete();

    const targetDb = createTestDatabase();
    await importReamData(targetDb, exportData);

    await expect(targetDb.tasks.toArray()).resolves.toHaveLength(2);
    await expect(targetDb.projects.toArray()).resolves.toHaveLength(2);
    await expect(targetDb.timeEntries.toArray()).resolves.toHaveLength(3);
    await expect(targetDb.activeTimers.toArray()).resolves.toEqual([]);
  });
});
