import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyActivitySample,
  setActivityTrackingEnabled,
  stopAutoTracker
} from "../shared/activityRepository";
import {
  assignActivities,
  isMeetingWindow,
  parseActivityListing,
  stepActivity,
  type ActivitySample
} from "../shared/activityTracking";
import { ReamDatabase } from "../shared/db";
import type { ActivityEngineState, TrackingRule } from "../shared/domain";
import { importReamData, readAllExportData } from "../shared/exportRepository";
import { parseReamExport } from "../shared/reporting";
import { createTask } from "../shared/taskRepository";

let database: ReamDatabase | null = null;

function createTestDatabase(): ReamDatabase {
  database = new ReamDatabase(`ream-activity-test-${crypto.randomUUID()}`);
  return database;
}

afterEach(async () => {
  if (database) {
    await database.delete();
    database = null;
  }
});

function engine(patch: Partial<ActivityEngineState> = {}): ActivityEngineState {
  return {
    id: "engine",
    enabled: true,
    lastSampleAt: "",
    idleThresholdSeconds: 120,
    suppressions: [],
    updatedAt: "2026-11-15T15:00:00.000Z",
    ...patch
  };
}

function rule(patch: Partial<TrackingRule> & Pick<TrackingRule, "id" | "kind" | "taskId">): TrackingRule {
  return {
    enabled: true,
    titleIncludes: "",
    appNames: [],
    createdAt: "2026-11-15T15:00:00.000Z",
    updatedAt: "2026-11-15T15:00:00.000Z",
    ...patch
  };
}

function sample(capturedAt: string, patch: Partial<ActivitySample> = {}): ActivitySample {
  return {
    capturedAt,
    idleSeconds: 0,
    frontmost: null,
    windows: [],
    permissionError: "",
    ...patch
  };
}

const meetingRule = rule({ id: "meetings", kind: "meeting", taskId: "task_meeting" });
const developmentRule = rule({ id: "development", kind: "development", taskId: "task_development" });

describe("activity classification", () => {
  it("treats a Teams meeting window and a Slack huddle as meetings", () => {
    expect(isMeetingWindow({ appName: "Microsoft Teams", title: "Chat | Microsoft Teams" })).toBe(false);
    expect(isMeetingWindow({ appName: "Microsoft Teams", title: "Design review | Microsoft Teams" })).toBe(true);
    expect(isMeetingWindow({ appName: "MSTeams", title: "Design review | Microsoft Teams" })).toBe(true);
    expect(isMeetingWindow({ appName: "Slack", title: "Huddle with #engineering" })).toBe(true);
    expect(isMeetingWindow({ appName: "Slack", title: "engineering" })).toBe(false);
  });

  it("parses the window listing", () => {
    const parsed = parseActivityListing([
      "F\u001fCursor\u001fream",
      "W\u001fCursor\u001fream",
      "W\u001fMicrosoft Teams\u001fDesign review | Microsoft Teams"
    ].join("\n"));

    expect(parsed.frontmost).toEqual({ appName: "Cursor", title: "ream" });
    expect(parsed.windows).toEqual([
      { appName: "Cursor", title: "ream" },
      { appName: "Microsoft Teams", title: "Design review | Microsoft Teams" }
    ]);
  });

  it("assigns a meeting and development work at the same time", () => {
    const assignments = assignActivities(sample("2026-11-15T15:00:00.000Z", {
      frontmost: { appName: "Cursor", title: "ream" },
      windows: [
        { appName: "Cursor", title: "ream" },
        { appName: "Microsoft Teams", title: "Design review | Microsoft Teams" }
      ]
    }), [meetingRule, developmentRule], 120, []);

    expect(assignments.map((assignment) => assignment.rule.id).sort()).toEqual(["development", "meetings"]);
  });

  it("prefers a title rule over the default development task", () => {
    const specific = rule({ id: "ream", kind: "development", taskId: "task_ream", titleIncludes: "ream", appNames: ["Cursor"] });
    const assignments = assignActivities(sample("2026-11-15T15:00:00.000Z", {
      frontmost: { appName: "Cursor", title: "ream — activity" }
    }), [developmentRule, specific], 120, []);

    expect(assignments.map((assignment) => assignment.rule.id)).toEqual(["ream"]);
  });

  it("does not count an idle coding app", () => {
    const assignments = assignActivities(sample("2026-11-15T15:00:00.000Z", {
      idleSeconds: 180,
      frontmost: { appName: "Cursor", title: "ream" }
    }), [developmentRule], 120, []);

    expect(assignments).toEqual([]);
  });
});

describe("activity steps", () => {
  it("keeps a meeting open while coding stops for idle time", () => {
    const opened = stepActivity({
      engine: engine(),
      rules: [meetingRule, developmentRule],
      trackers: [],
      sample: sample("2026-11-15T15:00:00.000Z", {
        frontmost: { appName: "Cursor", title: "ream" },
        windows: [
          { appName: "Cursor", title: "ream" },
          { appName: "Microsoft Teams", title: "Design review | Microsoft Teams" }
        ]
      })
    });
    const continued = stepActivity({
      engine: opened.engine,
      rules: [meetingRule, developmentRule],
      trackers: opened.trackers,
      sample: sample("2026-11-15T15:10:00.000Z", {
        frontmost: { appName: "Cursor", title: "ream" },
        windows: [
          { appName: "Cursor", title: "ream" },
          { appName: "Microsoft Teams", title: "Design review | Microsoft Teams" }
        ]
      })
    });
    const idled = stepActivity({
      engine: continued.engine,
      rules: [meetingRule, developmentRule],
      trackers: continued.trackers,
      sample: sample("2026-11-15T15:12:00.000Z", {
        idleSeconds: 180,
        frontmost: { appName: "Cursor", title: "ream" },
        windows: [
          { appName: "Cursor", title: "ream" },
          { appName: "Microsoft Teams", title: "Design review | Microsoft Teams" }
        ]
      })
    });

    expect(idled.trackers.map((tracker) => tracker.kind)).toEqual(["meeting"]);
    expect(idled.closed).toHaveLength(1);
    expect(idled.closed[0]?.endedAt).toBe("2026-11-15T15:09:00.000Z");
  });

  it("waits through a short gap before closing a meeting at the last sighting", () => {
    const opened = stepActivity({
      engine: engine(),
      rules: [meetingRule],
      trackers: [],
      sample: sample("2026-11-15T15:00:00.000Z", {
        windows: [{ appName: "Slack", title: "Huddle with Ada" }]
      })
    });
    const seen = stepActivity({
      engine: opened.engine,
      rules: [meetingRule],
      trackers: opened.trackers,
      sample: sample("2026-11-15T15:20:00.000Z", {
        windows: [{ appName: "Slack", title: "Huddle with Ada" }]
      })
    });
    const flicker = stepActivity({
      engine: seen.engine,
      rules: [meetingRule],
      trackers: seen.trackers,
      sample: sample("2026-11-15T15:20:20.000Z")
    });
    const ended = stepActivity({
      engine: flicker.engine,
      rules: [meetingRule],
      trackers: flicker.trackers,
      sample: sample("2026-11-15T15:21:00.000Z")
    });

    expect(flicker.closed).toEqual([]);
    expect(flicker.trackers).toHaveLength(1);
    expect(ended.closed[0]?.endedAt).toBe("2026-11-15T15:20:00.000Z");
  });

  it("ignores a repeated sample", () => {
    const opened = stepActivity({
      engine: engine(),
      rules: [meetingRule],
      trackers: [],
      sample: sample("2026-11-15T15:00:00.000Z", {
        windows: [{ appName: "Microsoft Teams", title: "Design review | Microsoft Teams" }]
      })
    });
    const repeat = stepActivity({
      engine: opened.engine,
      rules: [meetingRule],
      trackers: opened.trackers,
      sample: sample("2026-11-15T15:00:00.000Z", {
        windows: [{ appName: "Microsoft Teams", title: "Design review | Microsoft Teams" }]
      })
    });

    expect(repeat.changed).toBe(false);
    expect(repeat.trackers).toHaveLength(1);
  });
});

describe("activity repository", () => {
  it("creates meeting and development tasks and fills two entries", async () => {
    const db = createTestDatabase();
    await setActivityTrackingEnabled(db, true, new Date("2026-11-15T15:00:00.000Z"));
    const tasks = await db.tasks.toArray();
    expect(tasks.map((task) => task.title).sort()).toEqual(["Development", "Meetings"]);

    await applyActivitySample(db, sample("2026-11-15T15:00:00.000Z", {
      frontmost: { appName: "Cursor", title: "ream" },
      windows: [
        { appName: "Cursor", title: "ream" },
        { appName: "Microsoft Teams", title: "Design review | Microsoft Teams" }
      ]
    }));
    await applyActivitySample(db, sample("2026-11-15T15:10:00.000Z", {
      frontmost: { appName: "Cursor", title: "ream" },
      windows: [
        { appName: "Cursor", title: "ream" },
        { appName: "Microsoft Teams", title: "Design review | Microsoft Teams" }
      ]
    }));
    expect(await db.autoTrackers.count()).toBe(2);

    await applyActivitySample(db, sample("2026-11-15T15:12:00.000Z", {
      idleSeconds: 180,
      frontmost: { appName: "Cursor", title: "ream" },
      windows: [{ appName: "Microsoft Teams", title: "Design review | Microsoft Teams" }]
    }));
    await applyActivitySample(db, sample("2026-11-15T15:21:00.000Z"));

    const entries = await db.timeEntries.toArray();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.note).sort()).toEqual([
      "Cursor — ream",
      "Microsoft Teams — Design review | Microsoft Teams"
    ]);
    expect(await db.autoTrackers.count()).toBe(0);
  });

  it("discards a short flicker and does not duplicate a close", async () => {
    const db = createTestDatabase();
    const task = await createTask(db, { title: "Meetings" });
    await db.trackingRules.put(rule({ id: "meetings", kind: "meeting", taskId: task.id }));
    await db.activityEngine.put(engine());
    await applyActivitySample(db, sample("2026-11-15T15:00:00.000Z", {
      windows: [{ appName: "Slack", title: "Huddle with Ada" }]
    }));
    await applyActivitySample(db, sample("2026-11-15T15:00:05.000Z", {
      windows: [{ appName: "Slack", title: "Huddle with Ada" }]
    }));
    const closing = sample("2026-11-15T15:01:00.000Z");
    await Promise.all([applyActivitySample(db, closing), applyActivitySample(db, closing)]);

    expect(await db.timeEntries.count()).toBe(0);
    expect(await db.autoTrackers.count()).toBe(0);
  });

  it("saves one entry when two windows close the same long session", async () => {
    const db = createTestDatabase();
    const task = await createTask(db, { title: "Meetings" });
    await db.trackingRules.put(rule({ id: "meetings", kind: "meeting", taskId: task.id }));
    await db.activityEngine.put(engine());
    await applyActivitySample(db, sample("2026-11-15T15:00:00.000Z", {
      windows: [{ appName: "Slack", title: "Huddle with Ada" }]
    }));
    await applyActivitySample(db, sample("2026-11-15T15:20:00.000Z", {
      windows: [{ appName: "Slack", title: "Huddle with Ada" }]
    }));
    const closing = sample("2026-11-15T15:21:00.000Z");
    await Promise.all([applyActivitySample(db, closing), applyActivitySample(db, closing)]);

    const entries = await db.timeEntries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.durationSeconds).toBe(20 * 60);
  });

  it("does not reopen a dismissed window for fifteen minutes", async () => {
    const db = createTestDatabase();
    const task = await createTask(db, { title: "Meetings" });
    await db.trackingRules.put(rule({ id: "meetings", kind: "meeting", taskId: task.id }));
    await db.activityEngine.put(engine());
    await applyActivitySample(db, sample("2026-11-15T15:00:00.000Z", {
      windows: [{ appName: "Slack", title: "Huddle with Ada" }]
    }));
    const [tracker] = await db.autoTrackers.toArray();
    await stopAutoTracker(db, tracker?.id ?? "", "discard", new Date("2026-11-15T15:05:00.000Z"));
    await applyActivitySample(db, sample("2026-11-15T15:06:00.000Z", {
      windows: [{ appName: "Slack", title: "Huddle with Ada" }]
    }));

    expect(await db.autoTrackers.count()).toBe(0);
    expect(await db.timeEntries.count()).toBe(0);
  });

  it("round-trips tracking rules and drops open trackers on import", async () => {
    const source = createTestDatabase();
    await setActivityTrackingEnabled(source, true);
    await applyActivitySample(source, sample("2026-11-15T15:00:00.000Z", {
      windows: [{ appName: "Microsoft Teams", title: "Design review | Microsoft Teams" }]
    }));
    const exported = await readAllExportData(source);
    const parsed = parseReamExport(JSON.stringify(exported));
    expect(parsed.trackingRules.map((rule) => rule.kind).sort()).toEqual(["development", "meeting"]);

    const target = createTestDatabase();
    await target.autoTrackers.put({
      id: "stale",
      ruleId: "stale",
      taskId: "missing",
      kind: "meeting",
      startedAt: "2026-11-15T15:00:00.000Z",
      note: "",
      appName: "Slack",
      windowTitle: "Huddle",
      lastSeenAt: "2026-11-15T15:00:00.000Z",
      createdAt: "2026-11-15T15:00:00.000Z",
      updatedAt: "2026-11-15T15:00:00.000Z"
    });
    await importReamData(target, parsed);

    expect(await target.trackingRules.count()).toBe(2);
    expect(await target.autoTrackers.count()).toBe(0);
    await source.delete();
  });
});
