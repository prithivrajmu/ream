import type { ActivityEngineState, ActivityKind, ActivitySuppression, AutoTracker, TrackingRule } from "./domain";

export const ACTIVITY_ENGINE_ID = "engine" as const;
export const DEFAULT_MEETING_RULE_ID = "rule_default_meeting";
export const DEFAULT_DEVELOPMENT_RULE_ID = "rule_default_development";
export const DEFAULT_IDLE_THRESHOLD_SECONDS = 120;
export const MIN_IDLE_THRESHOLD_SECONDS = 30;
export const MAX_IDLE_THRESHOLD_SECONDS = 900;
export const MEETING_GRACE_SECONDS = 45;
export const DEVELOPMENT_GRACE_SECONDS = 20;
export const MIN_AUTO_ENTRY_SECONDS = 20;
export const MAX_ACTIVITY_NOTE_LINES = 12;
export const DISMISS_SUPPRESSION_SECONDS = 15 * 60;

export interface ActivityWindow {
  appName: string;
  title: string;
}

export interface ActivitySample {
  capturedAt: string;
  idleSeconds: number;
  frontmost: ActivityWindow | null;
  windows: ActivityWindow[];
  permissionError: string;
}

export interface ActivityAssignment {
  rule: TrackingRule;
  appName: string;
  windowTitle: string;
}

export interface ClosedAutoTracker {
  tracker: AutoTracker;
  endedAt: string;
}

export interface ActivityStep {
  changed: boolean;
  engine: ActivityEngineState;
  trackers: AutoTracker[];
  closed: ClosedAutoTracker[];
}

const DEVELOPMENT_APPS = new Set([
  "alacritty",
  "android studio",
  "clion",
  "code",
  "code - insiders",
  "cursor",
  "datagrip",
  "emacs",
  "fleet",
  "ghostty",
  "goland",
  "intellij idea",
  "iterm2",
  "kitty",
  "neovim",
  "nova",
  "phpstorm",
  "pycharm",
  "rider",
  "rubymine",
  "sublime text",
  "terminal",
  "vim",
  "visual studio code",
  "warp",
  "webstorm",
  "xcode",
  "zed"
]);

const TEAMS_SHELL_TITLE = /^(?:\(\d+\)\s*)?(?:chat|calendar|calls|activity|teams|files|apps|communities|copilot|walkie talkie|search|microsoft teams)(?:\s*\|.*)?$/i;

export function defaultActivityEngine(now = new Date()): ActivityEngineState {
  return {
    id: ACTIVITY_ENGINE_ID,
    enabled: false,
    lastSampleAt: "",
    idleThresholdSeconds: DEFAULT_IDLE_THRESHOLD_SECONDS,
    suppressions: [],
    updatedAt: now.toISOString()
  };
}

export function clampIdleThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_IDLE_THRESHOLD_SECONDS;
  return Math.min(MAX_IDLE_THRESHOLD_SECONDS, Math.max(MIN_IDLE_THRESHOLD_SECONDS, Math.floor(value)));
}

export function normalizeActivityEngine(value: ActivityEngineState | undefined, now = new Date()): ActivityEngineState {
  const fallback = defaultActivityEngine(now);
  if (!value) return fallback;
  return {
    id: ACTIVITY_ENGINE_ID,
    enabled: value.enabled === true,
    lastSampleAt: typeof value.lastSampleAt === "string" ? value.lastSampleAt : "",
    idleThresholdSeconds: clampIdleThreshold(value.idleThresholdSeconds),
    suppressions: Array.isArray(value.suppressions) ? value.suppressions.filter(isSuppression) : [],
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : fallback.updatedAt
  };
}

export function activitySignalKey(kind: ActivityKind, appName: string, title: string): string {
  return `${kind}:${appName.trim().toLocaleLowerCase()}:${title.trim().toLocaleLowerCase()}`;
}

export function autoEntryId(tracker: AutoTracker): string {
  return `entry_auto_${tracker.id}_${tracker.startedAt}`;
}

export function isMeetingApp(appName: string): boolean {
  const name = appName.trim().toLocaleLowerCase();
  return name === "slack" || name === "msteams" || name === "teams" || name.startsWith("microsoft teams");
}

export function isDevelopmentApp(appName: string): boolean {
  return DEVELOPMENT_APPS.has(appName.trim().toLocaleLowerCase());
}

export function isMeetingWindow(window: ActivityWindow): boolean {
  const title = window.title.trim();
  if (!title || !isMeetingApp(window.appName)) return false;
  if (window.appName.trim().toLocaleLowerCase() === "slack") {
    return /\bhuddle\b|\bcall\b|screen share/i.test(title);
  }
  return !TEAMS_SHELL_TITLE.test(title);
}

export function isActivitySample(value: unknown): value is ActivitySample {
  if (!isRecord(value)) return false;
  if (typeof value.capturedAt !== "string" || typeof value.idleSeconds !== "number" || typeof value.permissionError !== "string") return false;
  if (!isWindow(value.frontmost) && value.frontmost !== null) return false;
  return Array.isArray(value.windows) && value.windows.every(isWindow);
}

export function parseActivityListing(stdout: string): { frontmost: ActivityWindow | null; windows: ActivityWindow[] } {
  const windows: ActivityWindow[] = [];
  const seen = new Set<string>();
  let frontmost: ActivityWindow | null = null;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [kind, appName = "", title = ""] = line.split("\u001f");
    const window = { appName: appName.trim(), title: title.trim() };
    if (!window.appName) continue;
    if (kind === "F" && !frontmost) frontmost = window;
    if (kind !== "W" && kind !== "F") continue;
    const key = `${window.appName}\n${window.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    windows.push(window);
  }

  return { frontmost, windows };
}

export function noteWithObservation(note: string, appName: string, title: string): string {
  const label = title.trim() ? `${appName.trim()} — ${title.trim()}` : appName.trim();
  if (!label) return note;
  const lines = note.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.includes(label)) return lines.join("\n");
  lines.push(label);
  return lines.slice(-MAX_ACTIVITY_NOTE_LINES).join("\n");
}

export function assignActivities(
  sample: ActivitySample,
  rules: TrackingRule[],
  idleThresholdSeconds: number,
  suppressions: ActivitySuppression[]
): ActivityAssignment[] {
  const suppressed = new Set(suppressions.map((item) => item.key));
  const candidates: Array<ActivityAssignment & { specificity: number }> = [];
  const meetingWindows = sample.windows.filter(isMeetingWindow);
  const front = sample.frontmost;
  const developmentWindow = front && isDevelopmentApp(front.appName) && sample.idleSeconds < idleThresholdSeconds ? front : null;

  for (const window of meetingWindows) {
    const rule = matchRule("meeting", window, rules);
    if (!rule) continue;
    const key = activitySignalKey("meeting", window.appName, window.title);
    if (suppressed.has(key)) continue;
    candidates.push({ rule, appName: window.appName, windowTitle: window.title, specificity: specificity(rule) });
  }

  if (developmentWindow) {
    const rule = matchRule("development", developmentWindow, rules);
    if (rule) {
      const key = activitySignalKey("development", developmentWindow.appName, developmentWindow.title);
      if (!suppressed.has(key)) {
        candidates.push({
          rule,
          appName: developmentWindow.appName,
          windowTitle: developmentWindow.title,
          specificity: specificity(rule)
        });
      }
    }
  }

  candidates.sort((left, right) => right.specificity - left.specificity || left.rule.id.localeCompare(right.rule.id));
  const usedRules = new Set<string>();
  const assignments: ActivityAssignment[] = [];
  for (const candidate of candidates) {
    if (usedRules.has(candidate.rule.id)) continue;
    usedRules.add(candidate.rule.id);
    assignments.push({ rule: candidate.rule, appName: candidate.appName, windowTitle: candidate.windowTitle });
  }
  return assignments;
}

export function stepActivity(input: {
  engine: ActivityEngineState;
  rules: TrackingRule[];
  trackers: AutoTracker[];
  sample: ActivitySample;
  forceClose?: boolean;
}): ActivityStep {
  const unchanged: ActivityStep = { changed: false, engine: input.engine, trackers: input.trackers, closed: [] };
  if (!isActivitySample(input.sample)) return unchanged;
  const capturedMs = Date.parse(input.sample.capturedAt);
  if (Number.isNaN(capturedMs)) return unchanged;
  const lastMs = input.engine.lastSampleAt ? Date.parse(input.engine.lastSampleAt) : Number.NaN;
  if (!input.forceClose && !Number.isNaN(lastMs) && capturedMs <= lastMs) return unchanged;

  const engine = normalizeActivityEngine(input.engine);
  const suppressions = engine.suppressions.filter((item) => Date.parse(item.until) > capturedMs);
  const skipGrace = input.forceClose === true || !engine.enabled;
  const assignments = skipGrace
    ? []
    : assignActivities(input.sample, input.rules.filter((rule) => rule.enabled && rule.taskId), engine.idleThresholdSeconds, suppressions);
  const assignmentByRule = new Map(assignments.map((assignment) => [assignment.rule.id, assignment]));
  const idle = input.sample.idleSeconds >= engine.idleThresholdSeconds;
  const closed: ClosedAutoTracker[] = [];
  const remaining: AutoTracker[] = [];
  const seenRules = new Set<string>();

  for (const tracker of input.trackers) {
    const assignment = assignmentByRule.get(tracker.ruleId);
    if (assignment && !skipGrace) {
      seenRules.add(tracker.ruleId);
      remaining.push(updateTracker(tracker, assignment, input.sample.capturedAt));
      continue;
    }
    if (tracker.kind === "development" && idle && !skipGrace) {
      closed.push({ tracker, endedAt: idleEndedAt(tracker, input.sample) });
      continue;
    }
    const lastSeenMs = Date.parse(tracker.lastSeenAt);
    const graceSeconds = tracker.kind === "meeting" ? MEETING_GRACE_SECONDS : DEVELOPMENT_GRACE_SECONDS;
    const withinGrace = !Number.isNaN(lastSeenMs) && (capturedMs - lastSeenMs) / 1000 < graceSeconds;
    if (!skipGrace && withinGrace && !(tracker.kind === "development" && idle)) {
      remaining.push(tracker);
      continue;
    }
    closed.push({ tracker, endedAt: skipGrace ? input.sample.capturedAt : tracker.lastSeenAt || input.sample.capturedAt });
  }

  for (const assignment of assignments) {
    if (seenRules.has(assignment.rule.id)) continue;
    remaining.push(openTracker(assignment, input.sample.capturedAt));
  }

  const nextEngine: ActivityEngineState = {
    ...engine,
    lastSampleAt: input.sample.capturedAt,
    suppressions,
    updatedAt: input.sample.capturedAt
  };
  return { changed: true, engine: nextEngine, trackers: remaining, closed };
}

export function entryDurationSeconds(startedAt: string, endedAt: string): number {
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) return 0;
  return Math.floor((ended - started) / 1000);
}

function updateTracker(tracker: AutoTracker, assignment: ActivityAssignment, capturedAt: string): AutoTracker {
  return {
    ...tracker,
    taskId: assignment.rule.taskId,
    kind: assignment.rule.kind,
    appName: assignment.appName,
    windowTitle: assignment.windowTitle,
    note: noteWithObservation(tracker.note, assignment.appName, assignment.windowTitle),
    lastSeenAt: capturedAt,
    updatedAt: capturedAt
  };
}

function openTracker(assignment: ActivityAssignment, capturedAt: string): AutoTracker {
  return {
    id: assignment.rule.id,
    ruleId: assignment.rule.id,
    taskId: assignment.rule.taskId,
    kind: assignment.rule.kind,
    startedAt: capturedAt,
    note: noteWithObservation("", assignment.appName, assignment.windowTitle),
    appName: assignment.appName,
    windowTitle: assignment.windowTitle,
    lastSeenAt: capturedAt,
    createdAt: capturedAt,
    updatedAt: capturedAt
  };
}

function idleEndedAt(tracker: AutoTracker, sample: ActivitySample): string {
  const captured = Date.parse(sample.capturedAt);
  const started = Date.parse(tracker.startedAt);
  const end = captured - Math.max(0, sample.idleSeconds) * 1000;
  return new Date(Math.max(started, Math.min(captured, end))).toISOString();
}

function matchRule(kind: ActivityKind, window: ActivityWindow, rules: TrackingRule[]): TrackingRule | null {
  const matches = rules.filter((rule) => rule.enabled && rule.kind === kind && appNamesMatch(rule, window.appName) && titleMatches(rule, window.title));
  matches.sort((left, right) => specificity(right) - specificity(left) || left.id.localeCompare(right.id));
  return matches[0] ?? null;
}

function appNamesMatch(rule: TrackingRule, appName: string): boolean {
  if (rule.appNames.length === 0) return true;
  const name = appName.trim().toLocaleLowerCase();
  return rule.appNames.some((candidate) => candidate.trim().toLocaleLowerCase() === name);
}

function titleMatches(rule: TrackingRule, title: string): boolean {
  const needle = rule.titleIncludes.trim().toLocaleLowerCase();
  if (!needle) return true;
  return title.toLocaleLowerCase().includes(needle);
}

function specificity(rule: TrackingRule): number {
  return (rule.titleIncludes.trim() ? 1000 + rule.titleIncludes.trim().length : 0) + rule.appNames.length * 100;
}

function isSuppression(value: unknown): value is ActivitySuppression {
  return isRecord(value) && typeof value.key === "string" && typeof value.until === "string";
}

function isWindow(value: unknown): value is ActivityWindow {
  return isRecord(value) && typeof value.appName === "string" && typeof value.title === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
