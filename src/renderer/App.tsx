import { FormEvent, useEffect, useMemo, useState } from "react";
import { db } from "../shared/db";
import type { ActiveTimer, Task, TimeEntry } from "../shared/domain";
import { elapsedSeconds, formatDuration } from "../shared/time";
import { createTask, listActiveTasks, updateTask } from "../shared/taskRepository";
import { getActiveTimer, listTimeEntriesForDay, startTimer, stopTimer, updateActiveTimerNote } from "../shared/timerRepository";
import { parseTags } from "../shared/taskValidation";

type Route = "main" | "overlay";

function getRoute(): Route {
  return window.location.hash.includes("overlay") ? "overlay" : "main";
}

export function App() {
  const route = useMemo(getRoute, []);

  if (route === "overlay") {
    return <OverlayView />;
  }

  return <MainView />;
}

function MainView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [timerNote, setTimerNote] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState("");
  const [defaultNote, setDefaultNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const activeTask = activeTimer ? taskById.get(activeTimer.taskId) : null;

  async function refreshAppState() {
    const [nextTasks, nextActiveTimer, nextEntries] = await Promise.all([
      listActiveTasks(db),
      getActiveTimer(db),
      listTimeEntriesForDay(db)
    ]);

    setTasks(nextTasks);
    setEntries(nextEntries);
    setActiveTimer(nextActiveTimer);
    setTimerNote(nextActiveTimer?.note ?? "");

    if (nextActiveTimer) {
      setSelectedTaskId(nextActiveTimer.taskId);
      setElapsed(elapsedSeconds(nextActiveTimer.startedAt));
    } else {
      setElapsed(0);
      setSelectedTaskId((currentSelectedTaskId) => {
        if (currentSelectedTaskId && nextTasks.some((task) => task.id === currentSelectedTaskId)) {
          return currentSelectedTaskId;
        }
        return nextTasks[0]?.id ?? "";
      });
    }
  }

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
  }, []);

  useEffect(() => {
    if (!activeTimer) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setElapsed(elapsedSeconds(activeTimer.startedAt));
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

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Local-first desktop tracker</p>
          <h1>Timesheet Tracker</h1>
        </div>
        <button className="secondary-button" onClick={() => window.timesheetDesktop?.showMainWindow()}>
          Main Window
        </button>
      </section>

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

          {error ? <p className="error-text">{error}</p> : null}

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
            <p className="section-label">Today</p>
            <h2>Completed entries</h2>
          </div>
          <span className="count-pill">{entries.length} entries</span>
        </div>

        <div className="entry-list">
          {entries.length === 0 ? <p className="muted-copy">No completed time entries today.</p> : null}
          {entries.map((entry) => {
            const task = taskById.get(entry.taskId);
            return (
              <article className="entry-item" key={entry.id}>
                <div>
                  <h3>{task?.title ?? "Archived task"}</h3>
                  <p>{formatEntryTime(entry.startedAt)} - {formatEntryTime(entry.endedAt)}</p>
                  {entry.note ? <p className="entry-note">{entry.note}</p> : null}
                </div>
                <strong>{formatDuration(entry.durationSeconds)}</strong>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function OverlayView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [note, setNote] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [pinned, setPinned] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTimer?.taskId) ?? null,
    [activeTimer, tasks]
  );

  async function refreshOverlayState() {
    const [nextTasks, nextActiveTimer] = await Promise.all([listActiveTasks(db), getActiveTimer(db)]);

    setTasks(nextTasks);
    setActiveTimer(nextActiveTimer);
    setNote((currentNote) => {
      if (!nextActiveTimer) {
        return currentNote;
      }
      return currentNote === note ? nextActiveTimer.note : currentNote;
    });

    if (nextActiveTimer) {
      setSelectedTaskId(nextActiveTimer.taskId);
      setElapsed(elapsedSeconds(nextActiveTimer.startedAt));
    } else {
      setElapsed(0);
      setSelectedTaskId((currentSelectedTaskId) => {
        if (currentSelectedTaskId && nextTasks.some((task) => task.id === currentSelectedTaskId)) {
          return currentSelectedTaskId;
        }
        return nextTasks[0]?.id ?? "";
      });
    }
  }

  useEffect(() => {
    refreshOverlayState().catch((refreshError: unknown) => {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to load overlay data.");
    });

    const intervalId = window.setInterval(() => {
      refreshOverlayState().catch(() => undefined);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!activeTimer) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setElapsed(elapsedSeconds(activeTimer.startedAt));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [activeTimer]);

  async function togglePinned() {
    const nextPinned = !pinned;
    const actualPinned = await window.timesheetDesktop?.setOverlayPinned(nextPinned);
    setPinned(Boolean(actualPinned));
  }

  async function handleOverlayStart() {
    setError(null);

    try {
      const nextActiveTimer = await startTimer(db, { taskId: selectedTaskId, note });
      setActiveTimer(nextActiveTimer);
      setElapsed(0);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Unable to start timer.");
    }
  }

  async function handleOverlayStop() {
    setError(null);

    try {
      await updateActiveTimerNote(db, note);
      await stopTimer(db);
      setActiveTimer(null);
      setNote("");
      await refreshOverlayState();
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Unable to stop timer.");
    }
  }

  async function handleOverlayNoteBlur() {
    if (!activeTimer) {
      return;
    }

    try {
      const updated = await updateActiveTimerNote(db, note);
      setActiveTimer(updated);
    } catch (noteError) {
      setError(noteError instanceof Error ? noteError.message : "Unable to save note.");
    }
  }

  return (
    <main className={`overlay-shell ${expanded ? "overlay-expanded" : ""}`}>
      <header className="overlay-header">
        <span>Timesheet</span>
        <div className="overlay-actions">
          <button aria-label="Show main window" onClick={() => window.timesheetDesktop?.showMainWindow()}>
            Open
          </button>
          <button aria-label="Expand overlay" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Compact" : "Expand"}
          </button>
          <button aria-label="Pin overlay" onClick={togglePinned}>
            {pinned ? "Pinned" : "Pin"}
          </button>
          <button aria-label="Hide overlay" onClick={() => window.timesheetDesktop?.closeOverlay()}>
            Hide
          </button>
        </div>
      </header>

      <section className="overlay-task">
        <p className="section-label">Current</p>
        <h1>{activeTask?.title ?? "Choose a task"}</h1>
        <p className="overlay-time">{formatDuration(elapsed)}</p>

        <select
          aria-label="Task"
          value={selectedTaskId}
          disabled={Boolean(activeTimer) || tasks.length === 0}
          onChange={(event) => setSelectedTaskId(event.target.value)}
        >
          {tasks.length === 0 ? <option value="">Create a task in the main window</option> : null}
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>{task.title}</option>
          ))}
        </select>

        {activeTimer ? (
          <button className="primary-button stop-button wide" onClick={handleOverlayStop}>Stop</button>
        ) : (
          <button className="primary-button wide" disabled={!selectedTaskId} onClick={handleOverlayStart}>Start</button>
        )}
      </section>

      <textarea
        aria-label="Quick note"
        placeholder="Add a quick note..."
        value={note}
        onBlur={handleOverlayNoteBlur}
        onChange={(event) => setNote(event.target.value)}
      />

      {error ? <p className="overlay-error">{error}</p> : null}
    </main>
  );
}

function formatEntryTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
