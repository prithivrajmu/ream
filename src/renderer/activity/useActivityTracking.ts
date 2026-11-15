import { useEffect, useRef, useState } from "react";
import { liveQuery } from "dexie";
import {
  applyActivitySample,
  deleteTrackingRule,
  ensureDefaultTracking,
  getActivityEngine,
  listAutoTrackers,
  listTrackingRules,
  saveTrackingRule,
  setActivityIdleThreshold,
  setActivityTrackingEnabled,
  stopAllAutoTrackers,
  stopAutoTracker,
  type SaveTrackingRuleInput
} from "../../shared/activityRepository";
import type { ActivitySample } from "../../shared/activityTracking";
import { db } from "../../shared/db";
import type { ActivityEngineState, AutoTracker, TrackingRule } from "../../shared/domain";

export interface ActivityTrackingController {
  engine: ActivityEngineState | null;
  rules: TrackingRule[];
  trackers: AutoTracker[];
  nowMs: number;
  permissionError: string;
  lastAppName: string;
  error: string | null;
  busy: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  setIdleThreshold: (seconds: number) => Promise<void>;
  restoreDefaults: () => Promise<void>;
  saveRule: (input: SaveTrackingRuleInput) => Promise<void>;
  removeRule: (ruleId: string) => Promise<void>;
  stopTracker: (trackerId: string, mode: "save" | "discard") => Promise<void>;
  checkAccess: () => Promise<void>;
}

export function useActivityTracking(): ActivityTrackingController {
  const [engine, setEngine] = useState<ActivityEngineState | null>(null);
  const [rules, setRules] = useState<TrackingRule[]>([]);
  const [trackers, setTrackers] = useState<AutoTracker[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [permissionError, setPermissionError] = useState("");
  const [lastAppName, setLastAppName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queueRef = useRef(Promise.resolve());

  useEffect(() => {
    const subscription = liveQuery(async () => ({
      engine: await getActivityEngine(db),
      rules: await listTrackingRules(db),
      trackers: await listAutoTrackers(db)
    })).subscribe({
      next: (snapshot) => {
        setEngine(snapshot.engine);
        setRules(snapshot.rules);
        setTrackers(snapshot.trackers);
      },
      error: (queryError: unknown) => {
        setError(queryError instanceof Error ? queryError.message : "Unable to read automatic tracking.");
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const trackingEnabled = engine?.enabled;
  useEffect(() => {
    if (trackingEnabled === undefined) return;
    void window.reamDesktop?.setActivityWatch?.(trackingEnabled);
  }, [trackingEnabled]);

  useEffect(() => {
    if (!trackers.length) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [trackers.length]);

  useEffect(() => {
    const desktop = window.reamDesktop;
    if (!desktop?.onActivitySample) return;
    return desktop.onActivitySample((sample) => {
      queueRef.current = queueRef.current.then(() => acceptSample(sample)).catch((sampleError: unknown) => {
        setError(sampleError instanceof Error ? sampleError.message : "Unable to save the automatic entry.");
      });
    });
  }, []);

  useEffect(() => {
    const desktop = window.reamDesktop;
    if (!desktop?.onActivityFlush) return;
    return desktop.onActivityFlush((endedAt) => {
      queueRef.current = queueRef.current
        .then(() => stopAllAutoTrackers(db, endedAt))
        .then(() => undefined)
        .finally(() => desktop.notifyActivityFlushed?.());
    });
  }, []);

  async function acceptSample(sample: ActivitySample) {
    setPermissionError(sample.permissionError);
    setLastAppName(sample.frontmost?.appName ?? "");
    await applyActivitySample(db, sample);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update automatic tracking.");
    } finally {
      setBusy(false);
    }
  }

  return {
    engine,
    rules,
    trackers,
    nowMs,
    permissionError,
    lastAppName,
    error,
    busy,
    setEnabled: (enabled) => run(async () => {
      await setActivityTrackingEnabled(db, enabled);
      await window.reamDesktop?.setActivityWatch?.(enabled);
    }),
    setIdleThreshold: (seconds) => run(() => setActivityIdleThreshold(db, seconds).then(() => undefined)),
    restoreDefaults: () => run(() => ensureDefaultTracking(db)),
    saveRule: (input) => run(() => saveTrackingRule(db, input).then(() => undefined)),
    removeRule: (ruleId) => run(() => deleteTrackingRule(db, ruleId)),
    stopTracker: (trackerId, mode) => run(() => stopAutoTracker(db, trackerId, mode)),
    checkAccess: () => run(async () => {
      const sample = await window.reamDesktop?.sampleActivity?.();
      if (sample) await acceptSample(sample);
      else setPermissionError("Automatic tracking is available in the desktop app.");
    })
  };
}
