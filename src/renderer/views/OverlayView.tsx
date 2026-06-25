import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "../../shared/db";
import type { ActiveTimer, Task } from "../../shared/domain";
import { listActiveTasks } from "../../shared/taskRepository";
import { elapsedSeconds, formatDuration } from "../../shared/time";
import { getActiveTimer, startTimer, stopTimer, updateActiveTimerNote } from "../../shared/timerRepository";

export function OverlayView() {
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

  const refreshOverlayState = useCallback(async (syncNote = false) => {
    const [nextTasks, nextActiveTimer] = await Promise.all([listActiveTasks(db), getActiveTimer(db)]);

    setTasks(nextTasks);
    setActiveTimer(nextActiveTimer);

    if (syncNote && nextActiveTimer) {
      setNote(nextActiveTimer.note);
    }

    if (nextActiveTimer) {
      setSelectedTaskId(nextActiveTimer.taskId);
      setElapsed(elapsedSeconds(nextActiveTimer.startedAt));
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
    refreshOverlayState(true).catch((refreshError: unknown) => {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to load overlay data.");
    });

    const intervalId = window.setInterval(() => {
      refreshOverlayState().catch(() => undefined);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [refreshOverlayState]);

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
