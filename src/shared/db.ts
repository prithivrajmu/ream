import Dexie, { type Table } from "dexie";
import type { ActiveTimer, Task, TimeEntry } from "./domain";

export class TimesheetDatabase extends Dexie {
  tasks!: Table<Task, string>;
  timeEntries!: Table<TimeEntry, string>;
  activeTimers!: Table<ActiveTimer, string>;

  constructor(name = "timesheet-tracker") {
    super(name);

    this.version(1).stores({
      tasks: "id, title, project, archived, createdAt, updatedAt",
      timeEntries: "id, taskId, startedAt, endedAt, createdAt",
      activeTimers: "id, taskId, startedAt"
    });
  }
}

export const db = new TimesheetDatabase();
