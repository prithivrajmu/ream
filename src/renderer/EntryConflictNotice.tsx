import type { Project, Task, TimeEntry, UpdateTimeEntryInput } from "../shared/domain";
import { formatDuration } from "../shared/time";

export function EntryConflictNotice({ saved, local, tasks, projects, onUseSaved, onSaveMine }: {
  saved: TimeEntry;
  local: UpdateTimeEntryInput;
  tasks: Task[];
  projects: Project[];
  onUseSaved: () => void;
  onSaveMine: () => void;
}) {
  function describe(entry: UpdateTimeEntryInput) {
    return [
      `Task: ${tasks.find((task) => task.id === entry.taskId)?.title ?? entry.taskId}`,
      `Projects: ${entry.projectIds?.map((id) => projects.find((project) => project.id === id)?.title ?? id).join(", ") || "None"}`,
      `Start: ${new Date(entry.startedAt).toLocaleString()}`,
      `End: ${new Date(entry.endedAt).toLocaleString()}`,
      "", entry.note || "(Empty note)"
    ].join("\n");
  }
  return <section className="note-conflict-notice" aria-label="Resolve entry conflict">
    <p role="alert"><strong>This entry changed while you were editing.</strong> Your changes are still in the form and have not replaced the saved entry.</p>
    <div className="note-conflict-versions">
      <div><h3>Saved entry</h3><pre tabIndex={0}>{describe(saved)}</pre><p>Tracked duration: {formatDuration(saved.durationSeconds)}</p></div>
      <div><h3>Your entry</h3><pre tabIndex={0}>{describe(local)}</pre></div>
    </div>
    <p>You can keep editing the form to combine changes. Save my entry replaces the saved task, projects, times, and note. Duration is recalculated only if the times change.</p>
    <div className="note-conflict-actions">
      <button onClick={onUseSaved} type="button">Use saved entry</button>
      <button onClick={onSaveMine} type="button">Save my entry</button>
    </div>
  </section>;
}
