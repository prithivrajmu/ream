import {
  ACTIVITY_ENGINE_ID,
  DEFAULT_DEVELOPMENT_RULE_ID,
  DEFAULT_MEETING_RULE_ID,
  DISMISS_SUPPRESSION_SECONDS,
  MIN_AUTO_ENTRY_SECONDS,
  activitySignalKey,
  autoEntryId,
  clampIdleThreshold,
  defaultActivityEngine,
  entryDurationSeconds,
  isActivitySample,
  normalizeActivityEngine,
  stepActivity,
  type ActivitySample,
  type ActivityStep
} from "./activityTracking";
import type { ReamDatabase } from "./db";
import type { ActivityEngineState, ActivityKind, AutoTracker, Task, TimeEntry, TrackingRule } from "./domain";
import { createId } from "./id";
import { createTask } from "./taskRepository";

export interface SaveTrackingRuleInput {
  id?: string;
  kind: ActivityKind;
  titleIncludes: string;
  appName: string;
  taskId: string;
  enabled: boolean;
}

const ACTIVITY_TABLES = [
  "activityEngine",
  "trackingRules",
  "autoTrackers",
  "tasks",
  "timeEntries"
] as const;

export async function getActivityEngine(database: ReamDatabase, now = new Date()): Promise<ActivityEngineState> {
  return normalizeActivityEngine(await database.activityEngine.get(ACTIVITY_ENGINE_ID), now);
}

export async function listTrackingRules(database: ReamDatabase): Promise<TrackingRule[]> {
  const rules = await database.trackingRules.toArray();
  return rules.sort((left, right) => left.kind.localeCompare(right.kind) || left.titleIncludes.localeCompare(right.titleIncludes) || left.id.localeCompare(right.id));
}

export async function listAutoTrackers(database: ReamDatabase): Promise<AutoTracker[]> {
  const trackers = await database.autoTrackers.toArray();
  return trackers.sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
}

export async function setActivityTrackingEnabled(database: ReamDatabase, enabled: boolean, now = new Date()): Promise<ActivityEngineState> {
  return database.transaction("rw", activityTableList(database), async () => {
    if (enabled) await ensureDefaultTrackingInTransaction(database, now);
    const engine = normalizeActivityEngine(await database.activityEngine.get(ACTIVITY_ENGINE_ID), now);
    const next = { ...engine, enabled, updatedAt: now.toISOString() };
    if (!enabled) await persistStep(database, await closeStep(database, next, now));
    else await database.activityEngine.put(next);
    return normalizeActivityEngine(await database.activityEngine.get(ACTIVITY_ENGINE_ID), now);
  });
}

export async function setActivityIdleThreshold(database: ReamDatabase, idleThresholdSeconds: number, now = new Date()): Promise<ActivityEngineState> {
  return database.transaction("rw", database.activityEngine, async () => {
    const engine = normalizeActivityEngine(await database.activityEngine.get(ACTIVITY_ENGINE_ID), now);
    const next = { ...engine, idleThresholdSeconds: clampIdleThreshold(idleThresholdSeconds), updatedAt: now.toISOString() };
    await database.activityEngine.put(next);
    return next;
  });
}

export async function ensureDefaultTracking(database: ReamDatabase, now = new Date()): Promise<void> {
  await database.transaction("rw", [database.activityEngine, database.trackingRules, database.tasks], async () => {
    await ensureDefaultTrackingInTransaction(database, now);
  });
}

async function ensureDefaultTrackingInTransaction(database: ReamDatabase, now: Date): Promise<void> {
  const timestamp = now.toISOString();
  const rules = await database.trackingRules.toArray();
  if (!rules.some((rule) => rule.kind === "meeting")) {
    const task = await findOrCreateTask(database, "Meetings", "Filled in from Teams and Slack meetings.");
    await database.trackingRules.put(defaultRule(DEFAULT_MEETING_RULE_ID, "meeting", task.id, timestamp));
  }
  if (!rules.some((rule) => rule.kind === "development")) {
    const task = await findOrCreateTask(database, "Development", "Filled in from the coding app in front.");
    await database.trackingRules.put(defaultRule(DEFAULT_DEVELOPMENT_RULE_ID, "development", task.id, timestamp));
  }
  if (!(await database.activityEngine.get(ACTIVITY_ENGINE_ID))) {
    await database.activityEngine.put(defaultActivityEngine(now));
  }
}

export async function saveTrackingRule(database: ReamDatabase, input: SaveTrackingRuleInput, now = new Date()): Promise<TrackingRule> {
  return database.transaction("rw", [database.trackingRules, database.tasks, database.autoTrackers], async () => {
    const task = await database.tasks.get(input.taskId);
    if (!task || task.archived) throw new Error("Choose an active task for this rule.");
    if (input.kind !== "meeting" && input.kind !== "development") throw new Error("Choose a meeting or development rule.");
    const timestamp = now.toISOString();
    const existing = input.id ? await database.trackingRules.get(input.id) : undefined;
    const rule: TrackingRule = {
      id: existing?.id ?? input.id ?? createId("rule"),
      enabled: input.enabled,
      kind: input.kind,
      titleIncludes: input.titleIncludes.trim(),
      appNames: input.appName.trim() ? [input.appName.trim()] : [],
      taskId: task.id,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    await database.trackingRules.put(rule);
    const tracker = await database.autoTrackers.get(rule.id);
    if (tracker) {
      await database.autoTrackers.put({ ...tracker, taskId: rule.taskId, kind: rule.kind, updatedAt: timestamp });
    }
    return rule;
  });
}

export async function deleteTrackingRule(database: ReamDatabase, ruleId: string, now = new Date()): Promise<void> {
  await database.transaction("rw", activityTableList(database), async () => {
    const tracker = await database.autoTrackers.get(ruleId);
    if (tracker) await writeClosedTracker(database, tracker, now.toISOString(), now);
    await database.autoTrackers.delete(ruleId);
    await database.trackingRules.delete(ruleId);
  });
}

export async function applyActivitySample(database: ReamDatabase, sample: ActivitySample, now = new Date()): Promise<{ closedEntries: number }> {
  if (!isActivitySample(sample)) return { closedEntries: 0 };
  return database.transaction("rw", activityTableList(database), async () => {
    const engine = normalizeActivityEngine(await database.activityEngine.get(ACTIVITY_ENGINE_ID), now);
    if (!engine.enabled) return { closedEntries: 0 };
    const rules = await database.trackingRules.toArray();
    const trackers = await database.autoTrackers.toArray();
    const step = stepActivity({ engine, rules, trackers, sample });
    if (!step.changed) return { closedEntries: 0 };
    return persistStep(database, step, now);
  });
}

export async function stopAutoTracker(database: ReamDatabase, trackerId: string, mode: "save" | "discard", now = new Date()): Promise<void> {
  await database.transaction("rw", activityTableList(database), async () => {
    const tracker = await database.autoTrackers.get(trackerId);
    if (!tracker) return;
    if (mode === "save") await writeClosedTracker(database, tracker, now.toISOString(), now);
    await database.autoTrackers.delete(tracker.id);
    const engine = normalizeActivityEngine(await database.activityEngine.get(ACTIVITY_ENGINE_ID), now);
    const until = new Date(now.getTime() + DISMISS_SUPPRESSION_SECONDS * 1000).toISOString();
    const key = activitySignalKey(tracker.kind, tracker.appName, tracker.windowTitle);
    const suppressions = engine.suppressions.filter((item) => item.key !== key && Date.parse(item.until) > now.getTime());
    suppressions.push({ key, until });
    await database.activityEngine.put({ ...engine, suppressions, updatedAt: now.toISOString() });
  });
}

export async function stopAllAutoTrackers(database: ReamDatabase, endedAt: string, now = new Date()): Promise<number> {
  if (Number.isNaN(Date.parse(endedAt))) return 0;
  return database.transaction("rw", activityTableList(database), async () => {
    const engine = normalizeActivityEngine(await database.activityEngine.get(ACTIVITY_ENGINE_ID), now);
    const result = await persistStep(database, await closeStep(database, engine, new Date(endedAt)), now);
    return result.closedEntries;
  });
}

async function closeStep(database: ReamDatabase, engine: ActivityEngineState, now: Date): Promise<ActivityStep> {
  const sample: ActivitySample = {
    capturedAt: now.toISOString(),
    idleSeconds: 0,
    frontmost: null,
    windows: [],
    permissionError: ""
  };
  return stepActivity({
    engine,
    rules: await database.trackingRules.toArray(),
    trackers: await database.autoTrackers.toArray(),
    sample,
    forceClose: true
  });
}

async function persistStep(database: ReamDatabase, step: { engine: ActivityEngineState; trackers: AutoTracker[]; closed: Array<{ tracker: AutoTracker; endedAt: string }> }, now = new Date()): Promise<{ closedEntries: number }> {
  let closedEntries = 0;
  for (const closed of step.closed) {
    if (await writeClosedTracker(database, closed.tracker, closed.endedAt, now)) closedEntries += 1;
  }
  const keep = new Set(step.trackers.map((tracker) => tracker.id));
  const existing = await database.autoTrackers.toArray();
  for (const tracker of existing) {
    if (!keep.has(tracker.id)) await database.autoTrackers.delete(tracker.id);
  }
  if (step.trackers.length) await database.autoTrackers.bulkPut(step.trackers);
  await database.activityEngine.put(step.engine);
  return { closedEntries };
}

async function writeClosedTracker(database: ReamDatabase, tracker: AutoTracker, endedAt: string, now: Date): Promise<boolean> {
  const durationSeconds = entryDurationSeconds(tracker.startedAt, endedAt);
  if (durationSeconds < MIN_AUTO_ENTRY_SECONDS) return false;
  const task = await database.tasks.get(tracker.taskId);
  if (!task || task.archived) return false;
  const id = autoEntryId(tracker);
  if (await database.timeEntries.get(id)) return false;
  const timestamp = now.toISOString();
  const entry: TimeEntry = {
    id,
    taskId: task.id,
    projectIds: [...task.projectIds],
    startedAt: new Date(tracker.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationSeconds,
    note: tracker.note.trim(),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await database.timeEntries.add(entry);
  return true;
}

async function findOrCreateTask(database: ReamDatabase, title: string, defaultNote: string): Promise<Task> {
  const tasks = await database.tasks.toArray();
  const existing = tasks.find((task) => !task.archived && task.title.toLocaleLowerCase() === title.toLocaleLowerCase());
  if (existing) return existing;
  return createTask(database, { title, defaultNote });
}

function defaultRule(id: string, kind: ActivityKind, taskId: string, timestamp: string): TrackingRule {
  return {
    id,
    enabled: true,
    kind,
    titleIncludes: "",
    appNames: [],
    taskId,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function activityTableList(database: ReamDatabase) {
  return ACTIVITY_TABLES.map((name) => database[name]);
}
