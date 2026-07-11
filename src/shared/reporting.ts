import type { Project, Task, TimeEntry } from "./domain";

export interface TaskTotal {
  taskId: string;
  taskTitle: string;
  projects: string[];
  durationSeconds: number;
  entryCount: number;
}

export interface DaySummary {
  date: string;
  durationSeconds: number;
  entryCount: number;
}

export interface ReamExport {
  exportedAt: string;
  schemaVersion: 3;
  tasks: Task[];
  projects: Project[];
  timeEntries: TimeEntry[];
}

export function buildTaskTotals(entries: TimeEntry[], tasks: Task[], projects: Project[] = []): TaskTotal[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const totals = new Map<string, TaskTotal>();

  for (const entry of entries) {
    const task = taskById.get(entry.taskId);
    const current = totals.get(entry.taskId) ?? {
      taskId: entry.taskId,
      taskTitle: task?.title ?? "Archived task",
      projects: readEntryProjectTitles(entry, task, projectById),
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

export function createReamExport(tasks: Task[], projects: Project[], timeEntries: TimeEntry[], exportedAt = new Date()): ReamExport {
  return {
    exportedAt: exportedAt.toISOString(),
    schemaVersion: 3,
    tasks: [...tasks],
    projects: [...projects],
    timeEntries: [...timeEntries]
  };
}

export function serializeReamExport(exportData: ReamExport): string {
  return JSON.stringify(exportData, null, 2);
}

export function parseReamExport(value: string): ReamExport {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid Ream export file: JSON could not be parsed.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Invalid Ream export file: root object is required.");
  }

  if (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2 && parsed.schemaVersion !== 3) {
    throw new Error("Invalid Ream export file: unsupported schema version.");
  }

  if (!isIsoDateString(parsed.exportedAt)) {
    throw new Error("Invalid Ream export file: exportedAt must be an ISO timestamp.");
  }

  if (!Array.isArray(parsed.tasks)) {
    throw new Error("Invalid Ream export file: tasks must be an array.");
  }

  if (parsed.schemaVersion === 2 && !Array.isArray(parsed.projects)) {
    throw new Error("Invalid Ream export file: projects must be an array.");
  }

  if (!Array.isArray(parsed.timeEntries)) {
    throw new Error("Invalid Ream export file: timeEntries must be an array.");
  }

  const legacy = parsed.schemaVersion === 1 ? convertLegacyProjects(parsed.tasks) : null;
  const projects = (legacy?.projects ?? parsed.projects as unknown[]).map((project, index) => validateProject(project, index));
  const projectIds = new Set(projects.map((project) => project.id));
  const tasks = (legacy?.tasks ?? parsed.tasks).map((task, index) => validateTask(task, index, projectIds));
  const taskIds = new Set(tasks.map((task) => task.id));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const timeEntries = parsed.timeEntries.map((entry, index) => validateTimeEntry(
    parsed.schemaVersion === 1 && isRecord(entry) ? { ...entry, projectIds: undefined } : entry,
    index,
    taskIds,
    projectIds,
    taskById
  ));

  return {
    exportedAt: parsed.exportedAt,
    schemaVersion: 3,
    tasks,
    projects,
    timeEntries
  };
}

function convertLegacyProjects(tasks: unknown[]): { projects: Project[]; tasks: unknown[] } {
  const projectsByTitle = new Map<string, Project>();
  const convertedTasks = tasks.map((task, index) => {
    if (!isRecord(task)) {
      return task;
    }
    const title = typeof task.project === "string" ? task.project.trim() : "";
    if (!title) {
      return { ...task, projectIds: [] };
    }
    const key = title.toLocaleLowerCase();
    let project = projectsByTitle.get(key);
    if (!project) {
      const createdAt = typeof task.createdAt === "string" ? task.createdAt : new Date().toISOString();
      const updatedAt = typeof task.updatedAt === "string" ? task.updatedAt : createdAt;
      project = { id: `project-imported-${index + 1}`, title, archived: false, createdAt, updatedAt };
      projectsByTitle.set(key, project);
    }
    return { ...task, projectIds: [project.id] };
  });
  return { projects: [...projectsByTitle.values()], tasks: convertedTasks };
}

export function entriesToCsv(entries: TimeEntry[], tasks: Task[], projects: Project[] = []): string {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const rows = [
    ["task", "project", "started_at", "ended_at", "duration_seconds", "duration_hours", "note"]
  ];

  for (const entry of entries) {
    const task = taskById.get(entry.taskId);
    rows.push([
      task?.title ?? "Archived task",
      readEntryProjectTitles(entry, task, projectById).join(" | "),
      entry.startedAt,
      entry.endedAt,
      String(entry.durationSeconds),
      (entry.durationSeconds / 3600).toFixed(2),
      entry.note
    ]);
  }

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n") + "\n";
}

function validateTask(value: unknown, index: number, projectIds: Set<string>): Task {
  if (!isRecord(value)) {
    throw new Error(`Invalid Ream export file: task ${index + 1} must be an object.`);
  }

  const task: Task = {
    id: requireString(value, "id", `task ${index + 1}`),
    title: requireString(value, "title", `task ${index + 1}`),
    projectIds: requireStringArray(value, "projectIds", `task ${index + 1}`),
    tags: requireStringArray(value, "tags", `task ${index + 1}`),
    defaultNote: requireString(value, "defaultNote", `task ${index + 1}`),
    archived: requireBoolean(value, "archived", `task ${index + 1}`),
    createdAt: requireIsoDate(value, "createdAt", `task ${index + 1}`),
    updatedAt: requireIsoDate(value, "updatedAt", `task ${index + 1}`)
  };

  if (!task.id || !task.title.trim()) {
    throw new Error(`Invalid Ream export file: task ${index + 1} requires id and title.`);
  }

  if (task.projectIds.some((projectId) => !projectIds.has(projectId))) {
    throw new Error(`Invalid Ream export file: task ${index + 1} references an unknown project.`);
  }

  return task;
}

function validateProject(value: unknown, index: number): Project {
  if (!isRecord(value)) {
    throw new Error(`Invalid Ream export file: project ${index + 1} must be an object.`);
  }
  const project: Project = {
    id: requireString(value, "id", `project ${index + 1}`),
    title: requireString(value, "title", `project ${index + 1}`),
    archived: requireBoolean(value, "archived", `project ${index + 1}`),
    createdAt: requireIsoDate(value, "createdAt", `project ${index + 1}`),
    updatedAt: requireIsoDate(value, "updatedAt", `project ${index + 1}`)
  };
  if (!project.id || !project.title.trim()) {
    throw new Error(`Invalid Ream export file: project ${index + 1} requires id and title.`);
  }
  return project;
}

function validateTimeEntry(value: unknown, index: number, taskIds: Set<string>, projectIds: Set<string>, taskById: Map<string, Task>): TimeEntry {
  if (!isRecord(value)) {
    throw new Error(`Invalid Ream export file: time entry ${index + 1} must be an object.`);
  }

  const entry: TimeEntry = {
    id: requireString(value, "id", `time entry ${index + 1}`),
    taskId: requireString(value, "taskId", `time entry ${index + 1}`),
    projectIds: readOptionalStringArray(value, "projectIds", `time entry ${index + 1}`),
    startedAt: requireIsoDate(value, "startedAt", `time entry ${index + 1}`),
    endedAt: requireIsoDate(value, "endedAt", `time entry ${index + 1}`),
    durationSeconds: requireNonNegativeInteger(value, "durationSeconds", `time entry ${index + 1}`),
    note: requireString(value, "note", `time entry ${index + 1}`),
    createdAt: requireIsoDate(value, "createdAt", `time entry ${index + 1}`),
    updatedAt: requireIsoDate(value, "updatedAt", `time entry ${index + 1}`)
  };

  if (!entry.id || !taskIds.has(entry.taskId)) {
    throw new Error(`Invalid Ream export file: time entry ${index + 1} references an unknown task.`);
  }

  entry.projectIds = entry.projectIds.length ? entry.projectIds : taskById.get(entry.taskId)?.projectIds ?? [];
  if (entry.projectIds.some((projectId) => !projectIds.has(projectId))) {
    throw new Error(`Invalid Ream export file: time entry ${index + 1} references an unknown project.`);
  }

  if (new Date(entry.endedAt).getTime() < new Date(entry.startedAt).getTime()) {
    throw new Error(`Invalid Ream export file: time entry ${index + 1} ends before it starts.`);
  }

  return entry;
}

function readEntryProjectTitles(entry: TimeEntry, task: Task | undefined, projectById: Map<string, Project>): string[] {
  const projectIds = entry.projectIds.length ? entry.projectIds : task?.projectIds ?? [];
  return projectIds.map((id) => projectById.get(id)?.title).filter((title): title is string => Boolean(title));
}

function requireString(value: Record<string, unknown>, key: string, label: string): string {
  if (typeof value[key] !== "string") {
    throw new Error(`Invalid Ream export file: ${label}.${key} must be a string.`);
  }
  return value[key];
}

function requireStringArray(value: Record<string, unknown>, key: string, label: string): string[] {
  if (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === "string")) {
    throw new Error(`Invalid Ream export file: ${label}.${key} must be a string array.`);
  }
  return value[key];
}

function readOptionalStringArray(value: Record<string, unknown>, key: string, label: string): string[] {
  if (value[key] === undefined) {
    return [];
  }
  return requireStringArray(value, key, label);
}

function requireBoolean(value: Record<string, unknown>, key: string, label: string): boolean {
  if (typeof value[key] !== "boolean") {
    throw new Error(`Invalid Ream export file: ${label}.${key} must be a boolean.`);
  }
  return value[key];
}

function requireIsoDate(value: Record<string, unknown>, key: string, label: string): string {
  const date = requireString(value, key, label);
  if (!isIsoDateString(date)) {
    throw new Error(`Invalid Ream export file: ${label}.${key} must be an ISO timestamp.`);
  }
  return date;
}

function requireNonNegativeInteger(value: Record<string, unknown>, key: string, label: string): number {
  if (!Number.isInteger(value[key]) || typeof value[key] !== "number" || value[key] < 0) {
    throw new Error(`Invalid Ream export file: ${label}.${key} must be a non-negative integer.`);
  }
  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}
