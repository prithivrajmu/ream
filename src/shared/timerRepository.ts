import type { ActiveTimer, TimeEntry, UpdateTimeEntryInput } from "./domain";
import type { ReamDatabase } from "./db";
import { assertNoteUnchanged } from "./noteConflict";
import { assertEntryUnchanged } from "./entryConflict";
import { assertWorkspaceRevision } from "./workspaceRepository";
import { createId } from "./id";

const ACTIVE_TIMER_ID = "active";

export interface StartTimerInput {
  taskId: string;
  note?: string;
}

export async function getActiveTimer(database: ReamDatabase): Promise<ActiveTimer | null> {
  return normalizeActiveTimer((await database.activeTimers.get(ACTIVE_TIMER_ID)) ?? null);
}

export async function startTimer(
  database: ReamDatabase,
  input: StartTimerInput,
  now = new Date()
): Promise<ActiveTimer> {
  return database.transaction("rw", database.tasks, database.activeTimers, async () => {
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
      note: input.note ?? task.defaultNote ?? "",
      pausedAt: "",
      totalPausedSeconds: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await database.activeTimers.add(activeTimer);
    return activeTimer;
  });
}

export async function updateActiveTimerNote(
  database: ReamDatabase,
  note: string,
  now = new Date(),
  expectedStartedAt?: string,
  expectedNote?: string
): Promise<ActiveTimer> {
  return database.transaction("rw", database.activeTimers, async () => {
    const activeTimer = await getActiveTimer(database);
    if (!activeTimer) {
      throw new Error("No timer is running.");
    }
    assertTimerSession(activeTimer, expectedStartedAt);
    assertNoteUnchanged(activeTimer.note, expectedNote, note);

    const updated: ActiveTimer = {
      ...activeTimer,
      note,
      updatedAt: now.toISOString()
    };

    await database.activeTimers.put(updated);
    return updated;
  });
}

export async function pauseTimer(database: ReamDatabase, now = new Date()): Promise<ActiveTimer> {
  return database.transaction("rw", database.activeTimers, async () => {
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
  });
}

export async function resumeTimer(database: ReamDatabase, now = new Date()): Promise<ActiveTimer> {
  return database.transaction("rw", database.activeTimers, async () => {
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
  });
}

export async function stopTimer(database: ReamDatabase, now = new Date(), expectedStartedAt?: string): Promise<TimeEntry> {
  return database.transaction("rw", database.activeTimers, database.timeEntries, database.tasks, async () => {
    const activeTimer = await getActiveTimer(database);
    if (!activeTimer) {
      throw new Error("No timer is running.");
    }
    assertTimerSession(activeTimer, expectedStartedAt);

    const endedAt = now.toISOString();
    const timestamp = endedAt;
    const task = await database.tasks.get(activeTimer.taskId);
    const entry: TimeEntry = {
      id: createId("entry"),
      taskId: activeTimer.taskId,
      projectIds: task?.projectIds ?? [],
      startedAt: activeTimer.startedAt,
      endedAt,
      durationSeconds: activeTimerElapsedSeconds(activeTimer, now),
      note: activeTimer.note,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await database.timeEntries.add(entry);
    await database.activeTimers.delete(ACTIVE_TIMER_ID);

    return entry;
  });
}

function assertTimerSession(timer: ActiveTimer, expectedStartedAt?: string) {
  if (expectedStartedAt && timer.startedAt !== expectedStartedAt) {
    throw new Error("The timer changed in another window. Your note is kept as a recovery draft.");
  }
}

export async function createTimeEntry(
  database: ReamDatabase,
  input: UpdateTimeEntryInput,
  now = new Date(),
  expectedWorkspaceRevision?: number
): Promise<TimeEntry> {
  return database.transaction("rw", database.tasks, database.timeEntries, database.workspaceState, async () => {
    await assertWorkspaceRevision(database, expectedWorkspaceRevision);
    const task = await database.tasks.get(input.taskId);
    if (!task || task.archived) {
      throw new Error("Choose an active task for this entry.");
    }

    const entry = buildTimeEntry(createId("entry"), input, now, input.projectIds ?? task.projectIds);
    await database.timeEntries.add(entry);
    return entry;
  });
}

export async function updateTimeEntry(
  database: ReamDatabase,
  entryId: string,
  input: UpdateTimeEntryInput,
  now = new Date(),
  guard?: { expectedEntry: TimeEntry; expectedWorkspaceRevision: number }
): Promise<TimeEntry> {
  return database.transaction("rw", database.timeEntries, database.tasks, database.workspaceState, async () => {
    await assertWorkspaceRevision(database, guard?.expectedWorkspaceRevision);
    const [existing, task] = await Promise.all([
      database.timeEntries.get(entryId),
      database.tasks.get(input.taskId)
    ]);

    if (!existing) {
      throw new Error("Time entry not found. It may have been deleted; your changes remain in the editor.");
    }
    assertEntryUnchanged(existing, guard?.expectedEntry);

    if (!task) {
      throw new Error("Choose a valid task for this entry.");
    }

    const updated = {
      ...buildTimeEntry(existing.id, input, now, input.projectIds === undefined ? existing.projectIds : undefined),
      createdAt: existing.createdAt
    };
    if (updated.startedAt === existing.startedAt && updated.endedAt === existing.endedAt) {
      // Editing notes or projects must not turn paused time into tracked time.
      updated.durationSeconds = existing.durationSeconds;
    }
    await database.timeEntries.put(updated);
    return updated;
  });
}

function buildTimeEntry(entryId: string, input: UpdateTimeEntryInput, now = new Date(), fallbackProjectIds: string[] = []): TimeEntry {
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
    projectIds: normalizeProjectIds(input.projectIds ?? fallbackProjectIds),
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
    note: input.note?.trim() ?? "",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function normalizeProjectIds(projectIds: string[] = []): string[] {
  return Array.from(new Set(projectIds.filter(Boolean)));
}

export async function deleteTimeEntry(database: ReamDatabase, entryId: string): Promise<void> {
  const entry = await database.timeEntries.get(entryId);
  if (!entry) {
    throw new Error("Time entry not found.");
  }

  await database.timeEntries.delete(entryId);
}

export async function listTimeEntriesForDay(
  database: ReamDatabase,
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

export async function listTimeEntriesForTask(database: ReamDatabase, taskId: string): Promise<TimeEntry[]> {
  const entries = await database.timeEntries.where("taskId").equals(taskId).toArray();
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
