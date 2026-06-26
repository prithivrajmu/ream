import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { TimesheetDatabase } from "../shared/db";
import { createTask, updateTask } from "../shared/taskRepository";
import {
  activeTimerElapsedSeconds,
  createTimeEntry,
  deleteTimeEntry,
  getActiveTimer,
  listTimeEntriesForDay,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  updateTimeEntry,
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

  it("pauses and resumes without counting paused time", async () => {
    const db = createTestDatabase();
    const task = await createTask(db, { title: "Focused work" });

    await startTimer(db, { taskId: task.id }, new Date("2026-06-25T10:00:00.000Z"));
    const paused = await pauseTimer(db, new Date("2026-06-25T10:10:00.000Z"));

    expect(paused.pausedAt).toBe("2026-06-25T10:10:00.000Z");
    expect(activeTimerElapsedSeconds(paused, new Date("2026-06-25T10:20:00.000Z"))).toBe(600);

    const resumed = await resumeTimer(db, new Date("2026-06-25T10:20:00.000Z"));
    const entry = await stopTimer(db, new Date("2026-06-25T10:30:00.000Z"));

    expect(resumed.totalPausedSeconds).toBe(600);
    expect(entry.durationSeconds).toBe(1200);
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

  it("updates an entry's task, time range, note, and calculated duration", async () => {
    const db = createTestDatabase();
    const originalTask = await createTask(db, { title: "Initial task" });
    const revisedTask = await createTask(db, { title: "Revised task" });

    await startTimer(db, { taskId: originalTask.id }, new Date("2026-06-25T09:00:00.000Z"));
    const entry = await stopTimer(db, new Date("2026-06-25T09:30:00.000Z"));

    const updated = await updateTimeEntry(db, entry.id, {
      taskId: revisedTask.id,
      startedAt: "2026-06-24T13:00:00.000Z",
      endedAt: "2026-06-24T14:45:00.000Z",
      note: "Corrected entry"
    }, new Date("2026-06-26T09:00:00.000Z"));

    expect(updated).toMatchObject({
      taskId: revisedTask.id,
      startedAt: "2026-06-24T13:00:00.000Z",
      endedAt: "2026-06-24T14:45:00.000Z",
      durationSeconds: 6300,
      note: "Corrected entry",
      updatedAt: "2026-06-26T09:00:00.000Z"
    });
  });

  it("creates a completed time entry without starting a timer", async () => {
    const db = createTestDatabase();
    const task = await createTask(db, { title: "Manual work" });

    const entry = await createTimeEntry(db, {
      taskId: task.id,
      startedAt: "2026-06-25T08:00:00.000Z",
      endedAt: "2026-06-25T08:45:00.000Z",
      note: "Logged after the fact"
    }, new Date("2026-06-25T09:00:00.000Z"));

    expect(entry).toMatchObject({
      taskId: task.id,
      durationSeconds: 2700,
      note: "Logged after the fact",
      createdAt: "2026-06-25T09:00:00.000Z",
      updatedAt: "2026-06-25T09:00:00.000Z"
    });
    await expect(getActiveTimer(db)).resolves.toBeNull();
    await expect(db.timeEntries.get(entry.id)).resolves.toMatchObject({ taskId: task.id });
  });

  it("rejects invalid edits and deletes an existing entry", async () => {
    const db = createTestDatabase();
    const task = await createTask(db, { title: "Entry task" });

    await startTimer(db, { taskId: task.id }, new Date("2026-06-25T09:00:00.000Z"));
    const entry = await stopTimer(db, new Date("2026-06-25T09:30:00.000Z"));

    await expect(updateTimeEntry(db, entry.id, {
      taskId: task.id,
      startedAt: "2026-06-25T10:00:00.000Z",
      endedAt: "2026-06-25T09:00:00.000Z"
    })).rejects.toThrow("end time must be after");

    await deleteTimeEntry(db, entry.id);
    await expect(db.timeEntries.get(entry.id)).resolves.toBeUndefined();
    await expect(deleteTimeEntry(db, entry.id)).rejects.toThrow("Time entry not found.");
  });
});
