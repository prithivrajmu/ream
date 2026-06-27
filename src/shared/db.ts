import Dexie, { type Table } from "dexie";
import type { ActiveTimer, NoteAiSuggestion, Project, Task, TimeEntry } from "./domain";

export class TimesheetDatabase extends Dexie {
  tasks!: Table<Task, string>;
  projects!: Table<Project, string>;
  timeEntries!: Table<TimeEntry, string>;
  activeTimers!: Table<ActiveTimer, string>;
  noteAiSuggestions!: Table<NoteAiSuggestion, string>;

  constructor(name = "timesheet-tracker") {
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
        suggestion.durationMs = typeof suggestion.durationMs === "number" ? suggestion.durationMs : 0;
        suggestion.statusUpdatedAt = suggestion.statusUpdatedAt ?? suggestion.acceptedAt ?? null;
      });
    });
  }
}

export const db = new TimesheetDatabase();
