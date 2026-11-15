import { type SubmitEvent, useState } from "react";
import type { ActivityTrackingController } from "./useActivityTracking";
import { elapsedSeconds, formatDuration } from "../../shared/time";
import type { Task } from "../../shared/domain";

interface ActivityTrackingPanelProps {
  activity: ActivityTrackingController;
  tasks: Task[];
  mode: "summary" | "full";
  onOpenRules?: () => void;
}

export function ActivityTrackingPanel({ activity, tasks, mode, onOpenRules }: ActivityTrackingPanelProps) {
  const enabled = activity.engine?.enabled === true;
  const taskName = (taskId: string) => tasks.find((task) => task.id === taskId)?.title ?? "Choose a task";

  return (
    <section className={`auto-track ${mode === "summary" ? "is-summary" : ""}`}>
      <div className="section-title">
        <h2>Automatic tracking</h2>
        <span>{enabled ? "On" : "Off"}</span>
      </div>
      <p>Teams and Slack meetings keep running when you switch to a coding app. Coding time runs only while that app is in front, and it stops when the Mac is idle. Both can fill entries at the same time. Window titles stay on this Mac.</p>
      <div className="auto-track-actions">
        <button disabled={activity.busy} onClick={() => void activity.setEnabled(!enabled)} type="button">{enabled ? "Stop automatic tracking" : "Start automatic tracking"}</button>
        {mode === "summary" && onOpenRules ? <button onClick={onOpenRules} type="button">Rules</button> : null}
        <button disabled={activity.busy} onClick={() => void activity.checkAccess()} type="button">Check access</button>
      </div>
      {activity.permissionError ? <p className="dashboard-error" role="alert">{activity.permissionError}</p> : null}
      {activity.error ? <p className="dashboard-error" role="alert">{activity.error}</p> : null}
      {enabled && !activity.permissionError ? <p role="status">Watching{activity.lastAppName ? `. Last app: ${activity.lastAppName}` : "."}</p> : null}
      {activity.trackers.length === 0 ? <p className="empty-state">No meeting or coding session is open.</p> : (
        <ul className="auto-track-list">
          {activity.trackers.map((tracker) => (
            <li key={tracker.id}>
              <div>
                <strong>{tracker.kind === "meeting" ? "Meeting" : "Development"}</strong>
                <span>{formatDuration(elapsedSeconds(tracker.startedAt, new Date(activity.nowMs)))}</span>
              </div>
              <p>{taskName(tracker.taskId)}</p>
              <small>{tracker.windowTitle || tracker.appName}</small>
              <div className="auto-track-actions">
                <button disabled={activity.busy} onClick={() => void activity.stopTracker(tracker.id, "save")} type="button">Stop and save</button>
                <button disabled={activity.busy} onClick={() => void activity.stopTracker(tracker.id, "discard")} type="button">Dismiss</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {mode === "full" ? <ActivityRuleEditor activity={activity} tasks={tasks} /> : null}
    </section>
  );
}

function ActivityRuleEditor({ activity, tasks }: { activity: ActivityTrackingController; tasks: Task[] }) {
  const [kind, setKind] = useState<"meeting" | "development">("development");
  const [taskId, setTaskId] = useState("");
  const selectedTaskId = tasks.some((task) => task.id === taskId) ? taskId : (tasks[0]?.id ?? "");
  const [titleIncludes, setTitleIncludes] = useState("");
  const [appName, setAppName] = useState("");
  const idleMinutes = Math.round((activity.engine?.idleThresholdSeconds ?? 120) / 60);

  function addRule(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTaskId) return;
    void activity.saveRule({ kind, taskId: selectedTaskId, titleIncludes, appName, enabled: true });
    setTitleIncludes("");
    setAppName("");
  }

  return (
    <div className="auto-track-rules">
      <div className="section-title"><h2>Rules</h2></div>
      <label>Idle minutes before coding time stops
        <input
          aria-label="Idle minutes"
          min={1}
          max={15}
          type="number"
          value={idleMinutes}
          onChange={(event) => void activity.setIdleThreshold(Number(event.target.value) * 60)}
        />
      </label>
      {activity.rules.length === 0 ? <p className="empty-state">Start tracking to create Meetings and Development, or add a rule.</p> : (
        <ul className="auto-track-list">
          {activity.rules.map((rule) => (
            <li key={rule.id}>
              <div>
                <strong>{rule.kind === "meeting" ? "Meeting" : "Development"}</strong>
                <span>{rule.titleIncludes || "Any title"}{rule.appNames[0] ? ` · ${rule.appNames[0]}` : ""}</span>
              </div>
              <label>Task
                <select aria-label={`Task for ${rule.kind} rule`} value={rule.taskId} onChange={(event) => void activity.saveRule({ id: rule.id, kind: rule.kind, titleIncludes: rule.titleIncludes, appName: rule.appNames[0] ?? "", taskId: event.target.value, enabled: rule.enabled })}>
                  {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                  {tasks.some((task) => task.id === rule.taskId) ? null : <option value={rule.taskId}>Archived task</option>}
                </select>
              </label>
              <button disabled={activity.busy} onClick={() => void activity.removeRule(rule.id)} type="button">Remove</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={addRule}>
        <label>Kind
          <select aria-label="Rule kind" value={kind} onChange={(event) => setKind(event.target.value === "meeting" ? "meeting" : "development")}>
            <option value="meeting">Meeting</option>
            <option value="development">Development</option>
          </select>
        </label>
        <label>Task
          <select aria-label="Rule task" value={selectedTaskId} onChange={(event) => setTaskId(event.target.value)}>
            {tasks.length === 0 ? <option value="">Create a task first</option> : null}
            {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </label>
        <label>Title contains
          <input aria-label="Window title contains" value={titleIncludes} onChange={(event) => setTitleIncludes(event.target.value)} placeholder="Optional, such as ream" />
        </label>
        <label>App name
          <input aria-label="App name" value={appName} onChange={(event) => setAppName(event.target.value)} placeholder="Optional, such as Cursor" />
        </label>
        <div className="auto-track-actions">
          <button disabled={activity.busy || !selectedTaskId} type="submit">Add rule</button>
          <button disabled={activity.busy} onClick={() => void activity.restoreDefaults()} type="button">Restore defaults</button>
        </div>
      </form>
    </div>
  );
}
