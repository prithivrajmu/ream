import { FormEvent, useEffect, useMemo, useState } from "react";
import { db } from "../shared/db";
import type { Task } from "../shared/domain";
import { formatDuration } from "../shared/time";
import { createTask, listActiveTasks, updateTask } from "../shared/taskRepository";
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
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState("");
  const [defaultNote, setDefaultNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshTasks() {
    const nextTasks = await listActiveTasks(db);
    setTasks(nextTasks);
  }

  useEffect(() => {
    refreshTasks()
      .catch((refreshError: unknown) => {
        setError(refreshError instanceof Error ? refreshError.message : "Unable to load tasks.");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      await createTask(db, {
        title,
        project,
        tags: parseTags(tags),
        defaultNote
      });
      setTitle("");
      setProject("");
      setTags("");
      setDefaultNote("");
      await refreshTasks();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create task.");
    }
  }

  async function handleArchiveTask(task: Task) {
    setError(null);

    try {
      await updateTask(db, task.id, { archived: true });
      await refreshTasks();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to archive task.");
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
          <h2>Timer setup comes next</h2>
          <p className="timer-readout">{formatDuration(0)}</p>
          <div className="button-row">
            <button className="primary-button" disabled={tasks.length === 0}>Start</button>
            <button className="secondary-button" disabled={tasks.length === 0}>Add Note</button>
          </div>
          <p className="muted-copy compact-copy">
            Create tasks now. Stage 3 will connect these tasks to the active timer and time entries.
          </p>
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
                <button className="secondary-button" onClick={() => handleArchiveTask(task)}>Archive</button>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function OverlayView() {
  const [pinned, setPinned] = useState(true);
  const [note, setNote] = useState("");

  async function togglePinned() {
    const nextPinned = !pinned;
    const actualPinned = await window.timesheetDesktop?.setOverlayPinned(nextPinned);
    setPinned(Boolean(actualPinned));
  }

  return (
    <main className="overlay-shell">
      <header className="overlay-header">
        <span>Timesheet</span>
        <div className="overlay-actions">
          <button aria-label="Show main window" onClick={() => window.timesheetDesktop?.showMainWindow()}>
            Open
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
        <h1>Choose a task</h1>
        <p className="overlay-time">{formatDuration(0)}</p>
        <button className="primary-button wide">Start</button>
      </section>

      <textarea
        aria-label="Quick note"
        placeholder="Add a quick note..."
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
    </main>
  );
}
