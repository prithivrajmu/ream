import type { ActiveTimer, TimeEntry } from "./domain";
import type { TimesheetDatabase } from "./db";
import { createId } from "./id";
import { elapsedSeconds } from "./time";

const ACTIVE_TIMER_ID = "active";

export interface StartTimerInput {
  taskId: string;
  note?: string;
}

export async function getActiveTimer(database: TimesheetDatabase): Promise<ActiveTimer | null> {
  return (await database.activeTimers.get(ACTIVE_TIMER_ID)) ?? null;
}

export async function startTimer(
  database: TimesheetDatabase,
  input: StartTimerInput,
  now = new Date()
): Promise<ActiveTimer> {
  const task = await database.tasks.get(input.taskId);
  if (!task || task.archived) {
    throw new Error("Choose an active task before starting the timer.");
  }

  const existing = await getActiveTimer(database);
  if (existing) {
    throw new Error("A timer is already running.");
  }

  const timestamp = now.toISOString();
  const activeTimer: ActiveTimer = {
    id: ACTIVE_TIMER_ID,
    taskId: input.taskId,
    startedAt: timestamp,
    note: input.note?.trim() ?? "",
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await database.activeTimers.add(activeTimer);
  return activeTimer;
}

export async function updateActiveTimerNote(
  database: TimesheetDatabase,
  note: string,
  now = new Date()
): Promise<ActiveTimer> {
  const activeTimer = await getActiveTimer(database);
  if (!activeTimer) {
    throw new Error("No timer is running.");
  }

  const updated: ActiveTimer = {
    ...activeTimer,
    note: note.trim(),
    updatedAt: now.toISOString()
  };

  await database.activeTimers.put(updated);
  return updated;
}

export async function stopTimer(database: TimesheetDatabase, now = new Date()): Promise<TimeEntry> {
  const activeTimer = await getActiveTimer(database);
  if (!activeTimer) {
    throw new Error("No timer is running.");
  }

  const endedAt = now.toISOString();
  const timestamp = endedAt;
  const entry: TimeEntry = {
    id: createId("entry"),
    taskId: activeTimer.taskId,
    startedAt: activeTimer.startedAt,
    endedAt,
    durationSeconds: elapsedSeconds(activeTimer.startedAt, now),
    note: activeTimer.note,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await database.transaction("rw", database.activeTimers, database.timeEntries, async () => {
    await database.timeEntries.add(entry);
    await database.activeTimers.delete(ACTIVE_TIMER_ID);
  });

  return entry;
}

export async function listTimeEntriesForDay(
  database: TimesheetDatabase,
  day = new Date()
): Promise<TimeEntry[]> {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const entries = await database.timeEntries
    .where("startedAt")
    .between(start.toISOString(), end.toISOString(), true, false)
    .toArray();

  return entries.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}
