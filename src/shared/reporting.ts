import type { Task, TimeEntry } from "./domain";

export interface TaskTotal {
  taskId: string;
  taskTitle: string;
  project: string;
  durationSeconds: number;
  entryCount: number;
}

export interface DaySummary {
  date: string;
  durationSeconds: number;
  entryCount: number;
}

export interface TimesheetExport {
  exportedAt: string;
  schemaVersion: 1;
  tasks: Task[];
  timeEntries: TimeEntry[];
}

export function buildTaskTotals(entries: TimeEntry[], tasks: Task[]): TaskTotal[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const totals = new Map<string, TaskTotal>();

  for (const entry of entries) {
    const task = taskById.get(entry.taskId);
    const current = totals.get(entry.taskId) ?? {
      taskId: entry.taskId,
      taskTitle: task?.title ?? "Archived task",
      project: task?.project ?? "",
      durationSeconds: 0,
      entryCount: 0
    };

    current.durationSeconds += entry.durationSeconds;
    current.entryCount += 1;
    totals.set(entry.taskId, current);
  }

  return Array.from(totals.values()).sort((left, right) => {
    if (right.durationSeconds !== left.durationSeconds) {
      return right.durationSeconds - left.durationSeconds;
    }
    return left.taskTitle.localeCompare(right.taskTitle, undefined, { sensitivity: "base" });
  });
}

export function buildDailySummaries(entries: TimeEntry[]): DaySummary[] {
  const summaries = new Map<string, DaySummary>();

  for (const entry of entries) {
    const date = entry.startedAt.slice(0, 10);
    const current = summaries.get(date) ?? { date, durationSeconds: 0, entryCount: 0 };
    current.durationSeconds += entry.durationSeconds;
    current.entryCount += 1;
    summaries.set(date, current);
  }

  return Array.from(summaries.values()).sort((left, right) => right.date.localeCompare(left.date));
}

export function createTimesheetExport(tasks: Task[], timeEntries: TimeEntry[], exportedAt = new Date()): TimesheetExport {
  return {
    exportedAt: exportedAt.toISOString(),
    schemaVersion: 1,
    tasks: [...tasks],
    timeEntries: [...timeEntries]
  };
}

export function serializeTimesheetExport(exportData: TimesheetExport): string {
  return JSON.stringify(exportData, null, 2);
}

export function parseTimesheetExport(value: string): TimesheetExport {
  const parsed = JSON.parse(value) as Partial<TimesheetExport>;

  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.timeEntries)) {
    throw new Error("Invalid timesheet export file.");
  }

  return {
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
    schemaVersion: 1,
    tasks: parsed.tasks,
    timeEntries: parsed.timeEntries
  };
}

export function entriesToCsv(entries: TimeEntry[], tasks: Task[]): string {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const rows = [
    ["task", "project", "started_at", "ended_at", "duration_seconds", "duration_hours", "note"]
  ];

  for (const entry of entries) {
    const task = taskById.get(entry.taskId);
    rows.push([
      task?.title ?? "Archived task",
      task?.project ?? "",
      entry.startedAt,
      entry.endedAt,
      String(entry.durationSeconds),
      (entry.durationSeconds / 3600).toFixed(2),
      entry.note
    ]);
  }

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n") + "\n";
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}
