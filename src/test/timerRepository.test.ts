import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { TimesheetDatabase } from "../shared/db";
import { createTask, updateTask } from "../shared/taskRepository";
import {
  getActiveTimer,
  listTimeEntriesForDay,
  startTimer,
  stopTimer,
  updateActiveTimerNote
} from "../shared/timerRepository";

let database: TimesheetDatabase | null = null;

function createTestDatabase(): TimesheetDatabase {
  database = new TimesheetDatabase(`timesheet-timer-test-${crypto.randomUUID()}`);
  return database;
}

afterEach(async () => {
  if (database) {
    await database.delete();
    database = null;
  }
});

describe("timer repository", () => {
  it("starts one active timer and blocks duplicates", async () => {
    const db = createTestDatabase();
    const task = await createTask(db, { title: "Client meeting" });
    const startedAt = new Date("2026-06-25T10:00:00.000Z");

    const activeTimer = await startTimer(db, { taskId: task.id, note: "Kickoff" }, startedAt);

    expect(activeTimer.taskId).toBe(task.id);
    expect(activeTimer.startedAt).toBe(startedAt.toISOString());
    expect(activeTimer.note).toBe("Kickoff");
    await expect(startTimer(db, { taskId: task.id })).rejects.toThrow("A timer is already running.");
  });

  it("rejects missing or archived tasks", async () => {
    const db = createTestDatabase();
    const task = await createTask(db, { title: "Archived task" });
    await updateTask(db, task.id, { archived: true });

    await expect(startTimer(db, { taskId: "missing" })).rejects.toThrow("Choose an active task");
    await expect(startTimer(db, { taskId: task.id })).rejects.toThrow("Choose an active task");
  });

  it("updates notes and stops into a completed time entry", async () => {
    const db = createTestDatabase();
    const task = await createTask(db, { title: "Implementation" });

    await startTimer(db, { taskId: task.id }, new Date("2026-06-25T10:00:00.000Z"));
    await updateActiveTimerNote(db, "Finished repository tests", new Date("2026-06-25T10:05:00.000Z"));

    const entry = await stopTimer(db, new Date("2026-06-25T10:30:00.000Z"));

    expect(entry.taskId).toBe(task.id);
    expect(entry.durationSeconds).toBe(1800);
    expect(entry.note).toBe("Finished repository tests");
    await expect(getActiveTimer(db)).resolves.toBeNull();
  });

  it("lists entries for the selected day newest first", async () => {
    const db = createTestDatabase();
    const task = await createTask(db, { title: "Daily work" });

    await startTimer(db, { taskId: task.id }, new Date("2026-06-25T09:00:00.000Z"));
    const first = await stopTimer(db, new Date("2026-06-25T09:15:00.000Z"));
    await startTimer(db, { taskId: task.id }, new Date("2026-06-25T11:00:00.000Z"));
    const second = await stopTimer(db, new Date("2026-06-25T11:30:00.000Z"));

    const entries = await listTimeEntriesForDay(db, new Date("2026-06-25T18:00:00.000Z"));
    const otherDayEntries = await listTimeEntriesForDay(db, new Date("2026-06-26T10:00:00.000Z"));

    expect(entries.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(otherDayEntries).toEqual([]);
  });
});
