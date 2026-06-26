import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { TimesheetDatabase } from "../shared/db";
import { createTask, listActiveTasks, listAllTasks, updateTask } from "../shared/taskRepository";

let database: TimesheetDatabase | null = null;

function createTestDatabase(): TimesheetDatabase {
  database = new TimesheetDatabase(`timesheet-test-${crypto.randomUUID()}`);
  return database;
}

afterEach(async () => {
  if (database) {
    await database.delete();
    database = null;
  }
});

describe("task repository", () => {
  it("creates normalized active tasks", async () => {
    const db = createTestDatabase();

    const task = await createTask(db, {
      title: "  Prepare   sprint notes  ",
      projectIds: ["project_internal", "project_internal"],
      tags: ["Meeting", " coding ", "meeting", ""],
      defaultNote: "  Discuss blockers  "
    });

    expect(task.title).toBe("Prepare sprint notes");
    expect(task.projectIds).toEqual(["project_internal"]);
    expect(task.tags).toEqual(["coding", "meeting"]);
    expect(task.defaultNote).toBe("Discuss blockers");
    expect(task.archived).toBe(false);

    await expect(listActiveTasks(db)).resolves.toHaveLength(1);
  });

  it("rejects empty task titles", async () => {
    const db = createTestDatabase();

    await expect(createTask(db, { title: "   " })).rejects.toThrow("Task title is required.");
  });

  it("sorts active tasks and excludes archived tasks", async () => {
    const db = createTestDatabase();

    const later = await createTask(db, { title: "Write update" });
    await createTask(db, { title: "Answer email" });
    await updateTask(db, later.id, { archived: true });

    const activeTasks = await listActiveTasks(db);
    const allTasks = await listAllTasks(db);

    expect(activeTasks.map((task) => task.title)).toEqual(["Answer email"]);
    expect(allTasks.map((task) => task.title)).toEqual(["Answer email", "Write update"]);
    expect(allTasks.at(-1)?.archived).toBe(true);
  });
});
