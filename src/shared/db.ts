import Dexie, { type Table } from "dexie";
import type { ActiveTimer, NoteAiSuggestion, Project, Task, TimeEntry } from "./domain";

export const REAM_DATABASE_NAME = "ream";
export const LEGACY_DATABASE_NAME = "timesheet-tracker";

export class ReamDatabase extends Dexie {
  tasks!: Table<Task, string>;
  projects!: Table<Project, string>;
  timeEntries!: Table<TimeEntry, string>;
  activeTimers!: Table<ActiveTimer, string>;
  noteAiSuggestions!: Table<NoteAiSuggestion, string>;

  constructor(name = REAM_DATABASE_NAME) {
    super(name);

    this.version(1).stores({
      tasks: "id, title, project, archived, createdAt, updatedAt",
      timeEntries: "id, taskId, startedAt, endedAt, createdAt",
      activeTimers: "id, taskId, startedAt"
    });

    this.version(2).stores({
      tasks: "id, title, *projectIds, archived, createdAt, updatedAt",
      projects: "id, title, archived, createdAt, updatedAt",
      timeEntries: "id, taskId, startedAt, endedAt, createdAt",
      activeTimers: "id, taskId, startedAt"
    }).upgrade(async (transaction) => {
      type LegacyTask = Task & { project?: string };
      const taskTable = transaction.table("tasks") as Table<LegacyTask, string>;
      const legacyTasks = await taskTable.toArray();
      const projectIdsByTitle = new Map<string, string>();
      const projects: Project[] = [];

      for (const task of legacyTasks) {
        const legacyProject = task.project?.trim();
        let projectIds: string[] = [];
        if (legacyProject) {
          const key = legacyProject.toLocaleLowerCase();
          let projectId = projectIdsByTitle.get(key);
          if (!projectId) {
            projectId = `project-migrated-${projects.length + 1}`;
            projectIdsByTitle.set(key, projectId);
            projects.push({ id: projectId, title: legacyProject, archived: false, createdAt: task.createdAt, updatedAt: task.updatedAt });
          }
          projectIds = [projectId];
        }
        await taskTable.put({ ...task, projectIds });
      }

      if (projects.length) {
        await (transaction.table("projects") as Table<Project, string>).bulkPut(projects);
      }
    });

    this.version(3).stores({
      tasks: "id, title, *projectIds, archived, createdAt, updatedAt",
      projects: "id, title, archived, createdAt, updatedAt",
      timeEntries: "id, taskId, startedAt, endedAt, createdAt",
      activeTimers: "id, taskId, startedAt",
      noteAiSuggestions: "id, noteId, status, createdAt, acceptedAt"
    });

    this.version(4).stores({
      tasks: "id, title, *projectIds, archived, createdAt, updatedAt",
      projects: "id, title, archived, createdAt, updatedAt",
      timeEntries: "id, taskId, startedAt, endedAt, createdAt",
      activeTimers: "id, taskId, startedAt",
      noteAiSuggestions: "id, noteId, status, createdAt, statusUpdatedAt, acceptedAt"
    }).upgrade(async (transaction) => {
      const suggestions = transaction.table("noteAiSuggestions") as Table<NoteAiSuggestion, string>;
      await suggestions.toCollection().modify((suggestion) => {
        const statusTimestamp = suggestion.statusUpdatedAt ?? suggestion.acceptedAt ?? null;
        suggestion.durationMs = typeof suggestion.durationMs === "number"
          ? suggestion.durationMs
          : statusTimestamp
            ? Math.max(0, new Date(statusTimestamp).getTime() - new Date(suggestion.createdAt).getTime())
            : -1;
        suggestion.statusUpdatedAt = statusTimestamp;
      });
    });
  }
}

export async function migrateLegacyDatabase(database: ReamDatabase = db, legacyName = LEGACY_DATABASE_NAME): Promise<boolean> {
  if (database.name === legacyName || await hasAnyData(database) || !await Dexie.exists(legacyName)) {
    return false;
  }

  const legacyDatabase = new ReamDatabase(legacyName);

  try {
    const [tasks, projects, timeEntries, activeTimers, noteAiSuggestions] = await Promise.all([
      legacyDatabase.tasks.toArray(),
      legacyDatabase.projects.toArray(),
      legacyDatabase.timeEntries.toArray(),
      legacyDatabase.activeTimers.toArray(),
      legacyDatabase.noteAiSuggestions.toArray()
    ]);

    if (!tasks.length && !projects.length && !timeEntries.length && !activeTimers.length && !noteAiSuggestions.length) {
      return false;
    }

    await database.transaction("rw", database.tasks, database.projects, database.timeEntries, database.activeTimers, database.noteAiSuggestions, async () => {
      await bulkPutIfAny(database.tasks, tasks);
      await bulkPutIfAny(database.projects, projects);
      await bulkPutIfAny(database.timeEntries, timeEntries);
      await bulkPutIfAny(database.activeTimers, activeTimers);
      await bulkPutIfAny(database.noteAiSuggestions, noteAiSuggestions);
    });

    return true;
  } finally {
    legacyDatabase.close();
  }
}

async function hasAnyData(database: ReamDatabase): Promise<boolean> {
  const [taskCount, projectCount, timeEntryCount, activeTimerCount, noteAiSuggestionCount] = await Promise.all([
    database.tasks.count(),
    database.projects.count(),
    database.timeEntries.count(),
    database.activeTimers.count(),
    database.noteAiSuggestions.count()
  ]);
  return taskCount + projectCount + timeEntryCount + activeTimerCount + noteAiSuggestionCount > 0;
}

async function bulkPutIfAny<T>(table: Table<T, string>, records: T[]): Promise<void> {
  if (records.length) {
    await table.bulkPut(records);
  }
}

export const db = new ReamDatabase();
