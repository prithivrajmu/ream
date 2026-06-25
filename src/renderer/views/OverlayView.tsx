import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../shared/db";
import type { ActiveTimer, Task } from "../../shared/domain";
import { listActiveTasks } from "../../shared/taskRepository";
import { formatDuration } from "../../shared/time";
import {
  activeTimerElapsedSeconds,
  getActiveTimer,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  updateActiveTimerNote
} from "../../shared/timerRepository";

export function OverlayView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [note, setNote] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [pinned, setPinned] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTimer?.taskId) ?? null,
    [activeTimer, tasks]
  );
  const isPaused = Boolean(activeTimer?.pausedAt);

  const refreshOverlayState = useCallback(async (syncNote = false) => {
    const [nextTasks, nextActiveTimer] = await Promise.all([listActiveTasks(db), getActiveTimer(db)]);

    setTasks(nextTasks);
    setActiveTimer(nextActiveTimer);

    if (syncNote && nextActiveTimer) {
      setNote(nextActiveTimer.note);
    }

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
      setElapsed(activeTimerElapsedSeconds(activeTimer));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [activeTimer]);

  const setOverlayExpanded = useCallback(async (nextExpanded: boolean) => {
    setExpanded(nextExpanded);
    await window.timesheetDesktop?.setOverlayInteractive?.(true);
    await window.timesheetDesktop?.setOverlayExpanded?.(nextExpanded);
    if (nextExpanded) {
      window.setTimeout(() => noteInputRef.current?.focus(), 0);
      return;
    }
    await window.timesheetDesktop?.setOverlayInteractive?.(false);
  }, []);

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

  async function handlePauseResume() {
    if (!activeTimer) {
      return;
    }

    setError(null);

    try {
      const updated = activeTimer.pausedAt ? await resumeTimer(db) : await pauseTimer(db);
      setActiveTimer(updated);
      setElapsed(activeTimerElapsedSeconds(updated));
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "Unable to update timer.");
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
    <main
      className={`overlay-shell ${expanded ? "overlay-expanded" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          void setOverlayExpanded(false);
        }
      }}
      onFocus={() => void setOverlayExpanded(true)}
      onMouseEnter={() => void setOverlayExpanded(true)}
      onMouseLeave={() => void setOverlayExpanded(false)}
    >
      <section className="overlay-bar" aria-label="Timesheet overlay">
        <div className="overlay-task-summary">
          <span className={`overlay-status-dot ${isPaused ? "paused" : ""}`} />
          <div>
            <p>{activeTask?.title ?? "Choose a task"}</p>
            <span>{activeTimer ? (isPaused ? "Paused" : "Tracking") : "Ready"}</span>
          </div>
        </div>

        <strong className="overlay-time">{formatDuration(elapsed)}</strong>

        <div className="overlay-bar-actions">
          {activeTimer ? (
            <>
              <button className="overlay-button" onClick={handlePauseResume}>{isPaused ? "Resume" : "Pause"}</button>
              <button className="overlay-button danger" onClick={handleOverlayStop}>Stop</button>
            </>
          ) : (
            <button className="overlay-button primary" disabled={!selectedTaskId} onClick={handleOverlayStart}>Start</button>
          )}
        </div>
      </section>

      <section className="overlay-expanded-panel" aria-hidden={!expanded}>
        <header className="overlay-header">
          <span>Quick capture</span>
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

        <label className="overlay-field-label">
          Task
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
        </label>

        <textarea
          aria-label="Quick note"
          placeholder="Add notes while this stays out of your way..."
          value={note}
          onBlur={handleOverlayNoteBlur}
          onChange={(event) => setNote(event.target.value)}
        />

        {error ? <p className="overlay-error">{error}</p> : null}
      </section>
    </main>
  );
}
