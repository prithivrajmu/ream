import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { db } from "../../shared/db";
import type { ActiveTimer, Task, TimeEntry } from "../../shared/domain";
import { importTimesheetData, readAllExportData } from "../../shared/exportRepository";
import {
  buildDailySummaries,
  buildTaskTotals,
  createTimesheetExport,
  entriesToCsv,
  parseTimesheetExport,
  serializeTimesheetExport
} from "../../shared/reporting";
import { createTask, listActiveTasks, updateTask } from "../../shared/taskRepository";
import { parseTags } from "../../shared/taskValidation";
import { formatDuration } from "../../shared/time";
import { activeTimerElapsedSeconds, deleteTimeEntry, getActiveTimer, startTimer, stopTimer, updateActiveTimerNote, updateTimeEntry } from "../../shared/timerRepository";
import { downloadTextFile, formatEntryDateTime, totalDuration } from "../rendererUtils";

export function MainView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [allEntries, setAllEntries] = useState<TimeEntry[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [timerNote, setTimerNote] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState("");
  const [defaultNote, setDefaultNote] = useState("");
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [entryTaskId, setEntryTaskId] = useState("");
  const [entryStartedAt, setEntryStartedAt] = useState("");
  const [entryEndedAt, setEntryEndedAt] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const taskById = useMemo(() => new Map(allTasks.map((task) => [task.id, task])), [allTasks]);
  const activeTask = activeTimer ? taskById.get(activeTimer.taskId) : null;
  const dailySummaries = useMemo(() => buildDailySummaries(allEntries), [allEntries]);
  const taskTotals = useMemo(() => buildTaskTotals(allEntries, allTasks), [allEntries, allTasks]);
  const recentEntries = useMemo(
    () => [...allEntries].sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    [allEntries]
  );

  const refreshAppState = useCallback(async () => {
    const [nextTasks, nextActiveTimer, exportData] = await Promise.all([
      listActiveTasks(db),
      getActiveTimer(db),
      readAllExportData(db)
    ]);

    setTasks(nextTasks);
    setAllTasks(exportData.tasks);
    setAllEntries(exportData.timeEntries);
    setActiveTimer(nextActiveTimer);
    setTimerNote(nextActiveTimer?.note ?? "");

    if (nextActiveTimer) {
      setSelectedTaskId(nextActiveTimer.taskId);
      setElapsed(activeTimerElapsedSeconds(nextActiveTimer));
      return;
    }

    setElapsed(0);
    setSelectedTaskId((currentSelectedTaskId) => {
      if (currentSelectedTaskId && nextTasks.some((task) => task.id === currentSelectedTaskId)) {
        return currentSelectedTaskId;
      }
      return nextTasks[0]?.id ?? "";
    });
  }, []);

  useEffect(() => {
    refreshAppState()
      .catch((refreshError: unknown) => {
        setError(refreshError instanceof Error ? refreshError.message : "Unable to load app data.");
      })
      .finally(() => setLoading(false));

    const intervalId = window.setInterval(() => {
      refreshAppState().catch(() => undefined);
    }, 3000);

    window.addEventListener("focus", refreshAppState);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshAppState);
    };
  }, [refreshAppState]);

  useEffect(() => {
    if (!activeTimer) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setElapsed(activeTimerElapsedSeconds(activeTimer));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [activeTimer]);

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const task = await createTask(db, {
        title,
        project,
        tags: parseTags(tags),
        defaultNote
      });
      setTitle("");
      setProject("");
      setTags("");
      setDefaultNote("");
      await refreshAppState();
      setSelectedTaskId(task.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create task.");
    }
  }

  async function handleArchiveTask(task: Task) {
    setError(null);

    try {
      await updateTask(db, task.id, { archived: true });
      await refreshAppState();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to archive task.");
    }
  }

  async function handleStartTimer() {
    setError(null);

    try {
      const nextActiveTimer = await startTimer(db, { taskId: selectedTaskId, note: timerNote });
      setActiveTimer(nextActiveTimer);
      setElapsed(0);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Unable to start timer.");
    }
  }

  async function handleStopTimer() {
    setError(null);

    try {
      await updateActiveTimerNote(db, timerNote);
      await stopTimer(db);
      setTimerNote("");
      await refreshAppState();
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Unable to stop timer.");
    }
  }

  async function handleSaveTimerNote() {
    if (!activeTimer) {
      return;
    }

    setError(null);

    try {
      const updated = await updateActiveTimerNote(db, timerNote);
      setActiveTimer(updated);
    } catch (noteError) {
      setError(noteError instanceof Error ? noteError.message : "Unable to save timer note.");
    }
  }

  function handleEditEntry(entry: TimeEntry) {
    setError(null);
    setEditingEntry(entry);
    setEntryTaskId(entry.taskId);
    setEntryStartedAt(toDateTimeLocalValue(entry.startedAt));
    setEntryEndedAt(toDateTimeLocalValue(entry.endedAt));
    setEntryNote(entry.note);
  }

  function handleCloseEntryEditor() {
    setEditingEntry(null);
    setEntryTaskId("");
    setEntryStartedAt("");
    setEntryEndedAt("");
    setEntryNote("");
  }

  async function handleUpdateEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingEntry) {
      return;
    }

    setError(null);
    try {
      await updateTimeEntry(db, editingEntry.id, {
        taskId: entryTaskId,
        startedAt: entryStartedAt,
        endedAt: entryEndedAt,
        note: entryNote
      });
      handleCloseEntryEditor();
      await refreshAppState();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update time entry.");
    }
  }

  async function handleDeleteEntry(entry: TimeEntry) {
    if (!window.confirm("Delete this time entry permanently?")) {
      return;
    }

    setError(null);
    try {
      await deleteTimeEntry(db, entry.id);
      if (editingEntry?.id === entry.id) {
        handleCloseEntryEditor();
      }
      await refreshAppState();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete time entry.");
    }
  }

  async function handleExportJson() {
    setError(null);

    try {
      const exportData = await readAllExportData(db);
      downloadTextFile(
        `timesheet-export-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json",
        serializeTimesheetExport(createTimesheetExport(exportData.tasks, exportData.timeEntries))
      );
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export JSON.");
    }
  }

  async function handleExportCsv() {
    setError(null);

    try {
      const exportData = await readAllExportData(db);
      downloadTextFile(
        `timesheet-export-${new Date().toISOString().slice(0, 10)}.csv`,
        "text/csv",
        entriesToCsv(exportData.timeEntries, exportData.tasks)
      );
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export CSV.");
    }
  }

  async function handleImportJson(event: FormEvent<HTMLInputElement>) {
    setError(null);
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const exportData = parseTimesheetExport(text);
      const shouldRestore = window.confirm(
        `Import ${exportData.tasks.length} tasks and ${exportData.timeEntries.length} time entries? This replaces local data.`
      );
      if (!shouldRestore) {
        return;
      }
      await importTimesheetData(db, exportData);
      await refreshAppState();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Unable to import JSON.");
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Local-first desktop tracker</p>
          <h1>Timesheet Tracker</h1>
        </div>
        <div className="topbar-actions">
          <button className="secondary-button" onClick={() => window.timesheetDesktop?.showOverlayWindow?.()}>
            Show Overlay
          </button>
          <button className="secondary-button" onClick={() => window.timesheetDesktop?.toggleOverlayWindow?.()}>
            Toggle Overlay
          </button>
        </div>
      </section>

      {error ? <p className="error-text app-error" role="alert">{error}</p> : null}

      <section className="today-layout">
        <div className="panel timer-panel">
          <p className="section-label">Current Task</p>
          <h2>{activeTask?.title ?? "Select a task"}</h2>
          <p className="timer-readout">{formatDuration(elapsed)}</p>

          <label className="field-label">
            Task
            <select
              value={selectedTaskId}
              disabled={Boolean(activeTimer) || tasks.length === 0}
              onChange={(event) => setSelectedTaskId(event.target.value)}
            >
              {tasks.length === 0 ? <option value="">Create a task first</option> : null}
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>{task.title}</option>
              ))}
            </select>
          </label>

          <label className="field-label note-field">
            Timer note
            <textarea
              value={timerNote}
              onBlur={handleSaveTimerNote}
              onChange={(event) => setTimerNote(event.target.value)}
              placeholder="Capture meeting notes, decisions, or what changed..."
            />
          </label>

          <div className="button-row">
            {activeTimer ? (
              <button className="primary-button stop-button" onClick={handleStopTimer}>Stop</button>
            ) : (
              <button className="primary-button" disabled={!selectedTaskId} onClick={handleStartTimer}>Start</button>
            )}
            <button className="secondary-button" disabled={!activeTimer} onClick={handleSaveTimerNote}>Save Note</button>
          </div>
        </div>

        <div className="panel task-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Tasks</p>
              <h2>Create local tasks</h2>
            </div>
            <span className="count-pill">{tasks.length} active</span>
          </div>

          <form className="task-form" onSubmit={handleCreateTask}>
            <label>
              Task name
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Prepare sprint notes" />
            </label>
            <label>
              Project or client
              <input value={project} onChange={(event) => setProject(event.target.value)} placeholder="Internal" />
            </label>
            <label>
              Tags
              <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="meeting, coding" />
            </label>
            <label>
              Default note
              <textarea
                value={defaultNote}
                onChange={(event) => setDefaultNote(event.target.value)}
                placeholder="Optional context to carry into future entries"
              />
            </label>
            <button className="primary-button wide" type="submit">Create Task</button>
          </form>

          <div className="task-list" aria-live="polite">
            {loading ? <p className="muted-copy">Loading tasks...</p> : null}
            {!loading && tasks.length === 0 ? <p className="muted-copy">No active tasks yet.</p> : null}
            {tasks.map((task) => (
              <article className="task-item" key={task.id}>
                <div>
                  <h3>{task.title}</h3>
                  <p>{task.project || "No project"}</p>
                  {task.tags.length > 0 ? <p className="tag-line">{task.tags.join(", ")}</p> : null}
                </div>
                <button className="secondary-button" disabled={activeTimer?.taskId === task.id} onClick={() => handleArchiveTask(task)}>
                  Archive
                </button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel entries-panel">
        <div className="panel-heading">
          <div>
            <p className="section-label">Time entries</p>
            <h2>Recent completed entries</h2>
          </div>
          <span className="count-pill">{recentEntries.length} entries</span>
        </div>

        <div className="entry-list">
          {recentEntries.length === 0 ? <p className="muted-copy">No completed time entries yet.</p> : null}
          {recentEntries.map((entry) => {
            const task = taskById.get(entry.taskId);
            return (
              <article className="entry-item" key={entry.id}>
                <div>
                  <h3>{task?.title ?? "Archived task"}</h3>
                  <p>{formatEntryDateTime(entry.startedAt)} - {formatEntryDateTime(entry.endedAt)}</p>
                  {entry.note ? <p className="entry-note">{entry.note}</p> : null}
                </div>
                <div className="entry-actions">
                  <strong>{formatDuration(entry.durationSeconds)}</strong>
                  <div className="entry-action-buttons">
                    <button className="secondary-button" onClick={() => handleEditEntry(entry)}>Edit</button>
                    <button className="danger-button" onClick={() => handleDeleteEntry(entry)}>Delete</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {editingEntry ? (
        <div className="entry-editor-backdrop" role="presentation" onMouseDown={handleCloseEntryEditor}>
          <section
            aria-labelledby="entry-editor-title"
            aria-modal="true"
            className="entry-editor"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="panel-heading">
              <div>
                <p className="section-label">Edit entry</p>
                <h2 id="entry-editor-title">Correct a completed entry</h2>
              </div>
              <button aria-label="Close entry editor" className="secondary-button" onClick={handleCloseEntryEditor}>Close</button>
            </div>
            <form className="entry-edit-form" onSubmit={handleUpdateEntry}>
              <label>
                Task
                <select value={entryTaskId} onChange={(event) => setEntryTaskId(event.target.value)}>
                  {allTasks.map((task) => (
                    <option key={task.id} value={task.id}>{task.title}{task.archived ? " (archived)" : ""}</option>
                  ))}
                </select>
              </label>
              <label>
                Start
                <input required type="datetime-local" value={entryStartedAt} onChange={(event) => setEntryStartedAt(event.target.value)} />
              </label>
              <label>
                End
                <input required type="datetime-local" value={entryEndedAt} onChange={(event) => setEntryEndedAt(event.target.value)} />
              </label>
              <label className="entry-note-input">
                Note
                <textarea value={entryNote} onChange={(event) => setEntryNote(event.target.value)} placeholder="What was completed?" />
              </label>
              <div className="button-row entry-editor-actions">
                <button className="primary-button" type="submit">Save changes</button>
                <button className="secondary-button" type="button" onClick={handleCloseEntryEditor}>Cancel</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <section className="review-grid">
        <div className="panel summary-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Review</p>
              <h2>Daily totals</h2>
            </div>
            <span className="count-pill">{formatDuration(totalDuration(allEntries))}</span>
          </div>
          <div className="summary-list">
            {dailySummaries.length === 0 ? <p className="muted-copy">No completed work to summarize yet.</p> : null}
            {dailySummaries.slice(0, 7).map((summary) => (
              <div className="summary-row" key={summary.date}>
                <span>{summary.date}</span>
                <strong>{formatDuration(summary.durationSeconds)}</strong>
                <small>{summary.entryCount} entries</small>
              </div>
            ))}
          </div>
        </div>

        <div className="panel summary-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Tasks</p>
              <h2>Task totals</h2>
            </div>
            <span className="count-pill">{taskTotals.length} tracked</span>
          </div>
          <div className="summary-list">
            {taskTotals.length === 0 ? <p className="muted-copy">No task totals yet.</p> : null}
            {taskTotals.slice(0, 7).map((total) => (
              <div className="summary-row" key={total.taskId}>
                <span>{total.taskTitle}</span>
                <strong>{formatDuration(total.durationSeconds)}</strong>
                <small>{total.project || "No project"}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="panel export-panel">
          <div>
            <p className="section-label">Backup</p>
            <h2>Export and import</h2>
            <p className="muted-copy compact-copy">
              Export JSON for restore and private GitHub backup. Export CSV for reporting.
            </p>
            <ol className="backup-steps">
              <li>Export JSON from this panel.</li>
              <li>Place the file in <code>backups/</code>.</li>
              <li>Commit and push to a private GitHub repo.</li>
            </ol>
            <p className="shortcut-copy">Overlay shortcut: Cmd/Ctrl+Shift+T</p>
          </div>
          <div className="export-actions">
            <button className="primary-button" onClick={handleExportJson}>Export JSON</button>
            <button className="secondary-button" onClick={handleExportCsv}>Export CSV</button>
            <label className="import-button">
              Import JSON
              <input accept="application/json,.json" type="file" onChange={handleImportJson} />
            </label>
          </div>
        </div>
      </section>
    </main>
  );
}

function toDateTimeLocalValue(value: string): string {
  const date = new Date(value);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}
