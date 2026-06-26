import type { ActiveTimer, TimeEntry, UpdateTimeEntryInput } from "./domain";
import type { TimesheetDatabase } from "./db";
import { createId } from "./id";

const ACTIVE_TIMER_ID = "active";

export interface StartTimerInput {
  taskId: string;
  note?: string;
}

export async function getActiveTimer(database: TimesheetDatabase): Promise<ActiveTimer | null> {
  return normalizeActiveTimer((await database.activeTimers.get(ACTIVE_TIMER_ID)) ?? null);
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
    pausedAt: "",
    totalPausedSeconds: 0,
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

export async function pauseTimer(database: TimesheetDatabase, now = new Date()): Promise<ActiveTimer> {
  const activeTimer = await getActiveTimer(database);
  if (!activeTimer) {
    throw new Error("No timer is running.");
  }

  if (activeTimer.pausedAt) {
    return activeTimer;
  }

  const updated: ActiveTimer = {
    ...activeTimer,
    pausedAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  await database.activeTimers.put(updated);
  return updated;
}

export async function resumeTimer(database: TimesheetDatabase, now = new Date()): Promise<ActiveTimer> {
  const activeTimer = await getActiveTimer(database);
  if (!activeTimer) {
    throw new Error("No timer is running.");
  }

  if (!activeTimer.pausedAt) {
    return activeTimer;
  }

  const pausedSeconds = secondsBetween(activeTimer.pausedAt, now);
  const updated: ActiveTimer = {
    ...activeTimer,
    pausedAt: "",
    totalPausedSeconds: activeTimer.totalPausedSeconds + pausedSeconds,
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
    durationSeconds: activeTimerElapsedSeconds(activeTimer, now),
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

export async function createTimeEntry(
  database: TimesheetDatabase,
  input: UpdateTimeEntryInput,
  now = new Date()
): Promise<TimeEntry> {
  const task = await database.tasks.get(input.taskId);
  if (!task || task.archived) {
    throw new Error("Choose an active task for this entry.");
  }

  const entry = buildTimeEntry(createId("entry"), input, now);
  await database.timeEntries.add(entry);
  return entry;
}

export async function updateTimeEntry(
  database: TimesheetDatabase,
  entryId: string,
  input: UpdateTimeEntryInput,
  now = new Date()
): Promise<TimeEntry> {
  const [existing, task] = await Promise.all([
    database.timeEntries.get(entryId),
    database.tasks.get(input.taskId)
  ]);

  if (!existing) {
    throw new Error("Time entry not found.");
  }

  if (!task) {
    throw new Error("Choose a valid task for this entry.");
  }

  const updated = { ...buildTimeEntry(existing.id, input, now), createdAt: existing.createdAt };
  await database.timeEntries.put(updated);
  return updated;
}

function buildTimeEntry(entryId: string, input: UpdateTimeEntryInput, now = new Date()): TimeEntry {
  const startedAt = new Date(input.startedAt);
  const endedAt = new Date(input.endedAt);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    throw new Error("Enter valid start and end times.");
  }

  if (endedAt.getTime() < startedAt.getTime()) {
    throw new Error("The end time must be after the start time.");
  }

  const timestamp = now.toISOString();
  return {
    id: entryId,
    taskId: input.taskId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
    note: input.note?.trim() ?? "",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export async function deleteTimeEntry(database: TimesheetDatabase, entryId: string): Promise<void> {
  const entry = await database.timeEntries.get(entryId);
  if (!entry) {
    throw new Error("Time entry not found.");
  }

  await database.timeEntries.delete(entryId);
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

export function activeTimerElapsedSeconds(activeTimer: ActiveTimer, now = new Date()): number {
  const normalized = normalizeActiveTimer(activeTimer);
  if (!normalized) {
    return 0;
  }

  const effectiveNow = normalized.pausedAt ? new Date(normalized.pausedAt) : now;
  return Math.max(0, secondsBetween(normalized.startedAt, effectiveNow) - normalized.totalPausedSeconds);
}

function normalizeActiveTimer(activeTimer: ActiveTimer | null): ActiveTimer | null {
  if (!activeTimer) {
    return null;
  }

  return {
    ...activeTimer,
    pausedAt: activeTimer.pausedAt ?? "",
    totalPausedSeconds: activeTimer.totalPausedSeconds ?? 0
  };
}

function secondsBetween(start: string, end: Date): number {
  const started = new Date(start).getTime();
  if (Number.isNaN(started)) {
    return 0;
  }

  return Math.max(0, Math.floor((end.getTime() - started) / 1000));
}
