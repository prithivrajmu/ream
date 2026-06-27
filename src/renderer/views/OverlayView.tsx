import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_OLLAMA_MODEL, OLLAMA_MODEL_STORAGE_KEY, type ImprovedNoteOutput, validateImprovedNoteOutput } from "../../shared/ai";
import { createNoteAiSuggestion, listNoteAiSuggestions, updateNoteAiSuggestionStatus } from "../../shared/aiSuggestionRepository";
import { db } from "../../shared/db";
import type { ActiveTimer, NoteAiSuggestion, Project, Task, TimeEntry } from "../../shared/domain";
import { listActiveProjects } from "../../shared/projectRepository";
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
import { formatEntryDateTime } from "../rendererUtils";
import type { ThemeId } from "../themeOptions";

type IconName = "chevron" | "clock" | "close" | "list" | "note" | "pause" | "play" | "search" | "settings" | "stop" | "tag";

interface OverlayViewProps {
  themeId: ThemeId;
}

interface OverlayAiPreview {
  suggestionId: string;
  activeTimerId: string;
  model: string;
  rawNote: string;
  output: ImprovedNoteOutput;
}

export function OverlayView({ themeId }: OverlayViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentEntries, setRecentEntries] = useState<TimeEntry[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<NoteAiSuggestion[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [taskSearch, setTaskSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState<OverlayAiPreview | null>(null);

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTimer?.taskId) ?? null,
    [activeTimer, tasks]
  );
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const aiSuggestionByNoteId = useMemo(() => {
    const map = new Map<string, NoteAiSuggestion>();
    for (const suggestion of aiSuggestions) {
      if (!map.has(suggestion.noteId)) {
        map.set(suggestion.noteId, suggestion);
      }
    }
    return map;
  }, [aiSuggestions]);
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  );
  const displayTask = activeTask ?? selectedTask;
  const isPaused = Boolean(activeTimer?.pausedAt);
  const filteredTasks = useMemo(() => {
    const query = taskSearch.trim().toLocaleLowerCase();
    if (!query) {
      return tasks;
    }
    return tasks.filter((task) => `${task.title} ${task.tags.join(" ")}`.toLocaleLowerCase().includes(query));
  }, [taskSearch, tasks]);

  const refreshOverlayState = useCallback(async (syncNote = false) => {
    const [nextTasks, nextProjects, nextActiveTimer, nextRecentEntries, nextAiSuggestions] = await Promise.all([
      listActiveTasks(db),
      listActiveProjects(db),
      getActiveTimer(db),
      db.timeEntries.orderBy("startedAt").reverse().limit(3).toArray(),
      listNoteAiSuggestions(db)
    ]);

    setTasks(nextTasks);
    setProjects(nextProjects);
    setActiveTimer(nextActiveTimer);
    setRecentEntries(nextRecentEntries);
    setAiSuggestions(nextAiSuggestions);

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
    }, 3000);

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

  useEffect(() => {
    return window.timesheetDesktop?.onOverlayExpandedChanged?.(setExpanded);
  }, []);

  useEffect(() => {
    if (aiPreview && activeTimer?.id !== aiPreview.activeTimerId) {
      setAiPreview(null);
    }
  }, [activeTimer?.id, aiPreview]);

  useEffect(() => {
    if (!activeTimer || !noteDirty) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      updateActiveTimerNote(db, note)
        .then((updated) => {
          setActiveTimer((current) => current?.id === updated.id ? updated : current);
          setNoteDirty(false);
        })
        .catch((noteError: unknown) => {
          setError(noteError instanceof Error ? noteError.message : "Unable to save note.");
        });
    }, 600);

    return () => window.clearTimeout(timeoutId);
  }, [activeTimer, note, noteDirty]);

  async function setOverlayExpanded(nextExpanded: boolean) {
    await window.timesheetDesktop?.setOverlayExpanded?.(nextExpanded);
    setExpanded(nextExpanded);
  }

  async function handleOverlayStart() {
    setError(null);

    try {
      const nextActiveTimer = await startTimer(db, { taskId: selectedTaskId, note });
      setActiveTimer(nextActiveTimer);
      setAiPreview(null);
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

  async function handleOverlayStop(): Promise<boolean> {
    setError(null);

    try {
      await updateActiveTimerNote(db, note);
      await stopTimer(db);
      setActiveTimer(null);
      setNote("");
      setNoteDirty(false);
      setAiPreview(null);
      await refreshOverlayState();
      return true;
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Unable to stop timer.");
      return false;
    }
  }

  async function handleCompleteEntry() {
    if (await handleOverlayStop()) {
      await setOverlayExpanded(false);
    }
  }

  async function handleOpenMainWindow() {
    if (expanded) {
      await setOverlayExpanded(false);
    }

    await window.timesheetDesktop?.showMainWindow();
  }

  function handleQuickTag(tag: string) {
    setNoteDirty(true);
    setAiPreview(null);
    setNote((currentNote) => currentNote.includes(`#${tag}`) ? currentNote : `${currentNote}${currentNote ? " " : ""}#${tag}`);
  }

  function handleNoteChange(nextNote: string) {
    setNote(nextNote);
    setNoteDirty(true);
    setAiPreview(null);
  }

  async function handleImproveOverlayNote() {
    if (!activeTimer || !activeTask) {
      setError("Start a task before improving its note with AI.");
      return;
    }

    const noteText = note.trim();
    if (!noteText) {
      setError("Write a note before using AI.");
      return;
    }

    setError(null);
    setAiLoading(true);

    try {
      if (!window.timesheetDesktop?.improveNoteWithAi) {
        throw new Error("AI is only available in the desktop app.");
      }

      const projectName = activeTask.projectIds.map((id) => projectById.get(id)?.title).filter(Boolean).join(", ");
      const model = window.localStorage.getItem(OLLAMA_MODEL_STORAGE_KEY)?.trim() || DEFAULT_OLLAMA_MODEL;
      const requestStartedAt = readClockMs();
      const result = await window.timesheetDesktop.improveNoteWithAi({
        noteText,
        taskTitle: activeTask.title,
        projectName,
        tags: activeTask.tags,
        model
      });
      const durationMs = readClockMs() - requestStartedAt;
      const savedSuggestion = await createNoteAiSuggestion(db, {
        noteId: activeTimer.id,
        model: result.model,
        inputText: noteText,
        outputJson: result.output,
        durationMs
      });

      setAiPreview({
        suggestionId: savedSuggestion.id,
        activeTimerId: activeTimer.id,
        model: result.model,
        rawNote: noteText,
        output: result.output
      });
    } catch (improveError) {
      setError(improveError instanceof Error ? improveError.message : "Unable to improve note with AI.");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAcceptAiSuggestion(preview: OverlayAiPreview) {
    if (!activeTimer || activeTimer.id !== preview.activeTimerId) {
      setError("The active timer changed. Reject this suggestion and run AI again.");
      return;
    }

    if (!window.confirm("Replace this live note with the AI suggestion? The original raw note will remain stored with the AI record.")) {
      return;
    }

    setError(null);
    try {
      const updated = await updateActiveTimerNote(db, preview.output.clean_note);
      await updateNoteAiSuggestionStatus(db, preview.suggestionId, "accepted");
      setActiveTimer(updated);
      setNote(updated.note);
      setNoteDirty(false);
      setAiPreview(null);
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Unable to accept AI suggestion.");
    }
  }

  async function handleRejectAiSuggestion(preview: OverlayAiPreview) {
    setError(null);
    try {
      await updateNoteAiSuggestionStatus(db, preview.suggestionId, "rejected");
      setAiPreview(null);
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Unable to reject AI suggestion.");
    }
  }

  async function handleCopyAiSuggestion(preview: OverlayAiPreview) {
    setError(null);
    try {
      await navigator.clipboard.writeText(preview.output.clean_note);
      await updateNoteAiSuggestionStatus(db, preview.suggestionId, "copied");
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "Unable to copy AI suggestion.");
    }
  }

  async function handleOpenSavedAiSuggestion(preview: OverlayAiPreview) {
    setError(null);
    setAiPreview(preview);
  }

  function renderImproveNoteButton() {
    if (!activeTimer) {
      return null;
    }

    const noteText = note.trim();
    const savedSuggestion = aiSuggestionByNoteId.get(activeTimer.id);
    if (savedSuggestion && savedSuggestion.inputText === noteText) {
      return <button className="reference-ai-button is-muted" onClick={() => void handleOpenSavedAiSuggestion({
        suggestionId: savedSuggestion.id,
        activeTimerId: activeTimer.id,
        model: savedSuggestion.model,
        rawNote: savedSuggestion.inputText,
        output: validateImprovedNoteOutput(savedSuggestion.outputJson)
      })}>{getAiSuggestionButtonLabel(savedSuggestion)}</button>;
    }

    return (
      <button
        className="reference-ai-button"
        disabled={!noteText || aiLoading}
        onClick={handleImproveOverlayNote}
      >
        {aiLoading ? "Improving..." : "Improve with AI"}
      </button>
    );
  }

  function getAiSuggestionButtonLabel(suggestion: NoteAiSuggestion): string {
    if (suggestion.status === "accepted") {
      return "AI improved";
    }
    if (suggestion.status === "rejected") {
      return "AI rejected";
    }
    if (suggestion.status === "copied") {
      return "AI copied";
    }
    return "AI preview";
  }

  return (
    <main className={`overlay-shell reference-overlay-shell theme-${themeId} ${expanded ? "is-expanded" : ""}`} aria-label="Ream overlay">
      <header className="reference-overlay-bar">
        <div className="reference-overlay-identity">
          <span className="reference-app-icon"><Icon name="clock" /></span>
          <p>{displayTask?.title ?? "Select a task"}</p>
          <span className={`reference-status ${isPaused ? "paused" : ""}`}>
            <i />{activeTimer ? (isPaused ? "Paused" : "Tracking") : "Ready"}
          </span>
        </div>

        <button
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse overlay" : "Expand overlay"}
          className="reference-expand-button"
          onClick={() => void setOverlayExpanded(!expanded)}
        >
          <Icon name="chevron" />
        </button>

        <div className="reference-overlay-actions">
          <strong>{formatDuration(elapsed)}</strong>
          {activeTimer ? (
            <button aria-label={isPaused ? "Resume timer" : "Pause timer"} className="reference-icon-button pause" onClick={handlePauseResume}>
              <Icon name={isPaused ? "play" : "pause"} />
            </button>
          ) : (
            <button aria-label="Start timer" className="reference-start-button" disabled={!selectedTaskId} onClick={handleOverlayStart}>Start</button>
          )}
          <button aria-label="Stop timer" className="reference-icon-button stop" disabled={!activeTimer} onClick={handleOverlayStop}>
            <Icon name="stop" />
          </button>
          <button aria-label="Open main window" className="reference-plain-button" onClick={() => void handleOpenMainWindow()}>
            <Icon name="settings" />
          </button>
          <button aria-label="Close overlay" className="reference-plain-button" onClick={(event) => {
            event.stopPropagation();
            void window.timesheetDesktop?.closeOverlay();
          }}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      {expanded ? (
        <section className="reference-overlay-panel">
          <div className="reference-task-picker">
            <label htmlFor="overlay-task-select">Select Task</label>
            <div className="reference-picker-row">
              <div className="reference-select-wrap">
                <Icon name="list" />
                <select
                  id="overlay-task-select"
                  value={selectedTaskId}
                  disabled={Boolean(activeTimer) || tasks.length === 0}
                  onChange={(event) => setSelectedTaskId(event.target.value)}
                >
                  {tasks.length === 0 ? <option value="">Create a task in the main window</option> : null}
                  {filteredTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </select>
                <Icon name="chevron" />
              </div>
              <label className="reference-search" aria-label="Search tasks">
                <Icon name="search" />
                <input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search tasks..." />
                <kbd>⌘K</kbd>
              </label>
            </div>
          </div>

          <div className="reference-workspace">
            <section className="reference-timer-column">
              <div className="reference-timer-card">
                <div>
                  <p className={`reference-timer-status ${isPaused ? "paused" : ""}`}><i />{activeTimer ? (isPaused ? "PAUSED" : "TRACKING") : "READY"} ›</p>
                  <strong>{formatDuration(elapsed)}</strong>
                  <p className="reference-timer-caption">{activeTimer ? `${isPaused ? "Paused" : "Started"} ${formatEntryDateTime(activeTimer.startedAt)}` : "Start tracking your next task"}</p>
                </div>
                <button
                  aria-label={activeTimer ? (isPaused ? "Resume timer" : "Pause timer") : "Start timer"}
                  className={`reference-ring-button ${isPaused ? "paused" : ""}`}
                  disabled={!activeTimer && !selectedTaskId}
                  onClick={activeTimer ? handlePauseResume : handleOverlayStart}
                >
                  <Icon name={activeTimer ? (isPaused ? "play" : "pause") : "play"} />
                </button>
              </div>

              <div className="reference-control-row">
                <button className="stop-control" disabled={!activeTimer} onClick={handleOverlayStop}><Icon name="stop" />Stop</button>
                <button
                  aria-label="Finish entry and save its duration"
                  className="complete-control"
                  disabled={!activeTimer}
                  title="Finish entry, save its duration, and collapse the overlay"
                  onClick={handleCompleteEntry}
                >
                  ✓ Finish entry
                </button>
              </div>

              <div className="reference-tags">
                <p>Task Tags</p>
                <div>
                  {(displayTask?.tags ?? []).slice(0, 4).map((tag) => (
                    <button key={tag} onClick={() => handleQuickTag(tag)}><Icon name="tag" />{tag}</button>
                  ))}
                </div>
              </div>
            </section>

            <section className="reference-notes-card">
              <div className="reference-notes-heading">
                <span><Icon name="note" />Task Notes</span>
                {renderImproveNoteButton()}
              </div>
              <textarea
                aria-label="Task notes"
                placeholder="Write your notes here..."
                value={note}
                onChange={(event) => handleNoteChange(event.target.value)}
              />
              {aiPreview ? (
                <div className="reference-ai-preview">
                  <section>
                    <h3>Raw note</h3>
                    <p>{aiPreview.rawNote}</p>
                  </section>
                  <section>
                    <h3>AI suggestion</h3>
                    <p>{aiPreview.output.clean_note}</p>
                    <dl>
                      <div><dt>Summary</dt><dd>{aiPreview.output.summary}</dd></div>
                      <div><dt>Next steps</dt><dd>{aiPreview.output.next_steps.length ? aiPreview.output.next_steps.join("; ") : "None"}</dd></div>
                      <div><dt>Blockers</dt><dd>{aiPreview.output.blockers.length ? aiPreview.output.blockers.join("; ") : "None"}</dd></div>
                      <div><dt>Tags</dt><dd>{aiPreview.output.tags.length ? aiPreview.output.tags.join(", ") : "None"}</dd></div>
                    </dl>
                    <small>Model: {aiPreview.model}</small>
                    <div className="reference-ai-actions">
                      <button onClick={() => void handleAcceptAiSuggestion(aiPreview)}>Accept</button>
                      <button onClick={() => void handleCopyAiSuggestion(aiPreview)}>Copy suggestion</button>
                      <button onClick={() => void handleRejectAiSuggestion(aiPreview)}>Reject</button>
                    </div>
                  </section>
                </div>
              ) : null}
            </section>
          </div>

          <section className="reference-recent-notes">
            <div className="reference-recent-heading"><h2>Recent Notes</h2><button onClick={() => void handleOpenMainWindow()}>View all <Icon name="chevron" /></button></div>
            <div className="reference-recent-list">
              {recentEntries.length === 0 ? <p>No completed entries yet.</p> : recentEntries.map((entry) => {
                const aiSuggestion = aiSuggestionByNoteId.get(entry.id);
                return <article key={entry.id}>
                  <span className="reference-entry-icon"><Icon name="note" /></span>
                  <div><p>{entry.note || "No note added"}</p><small>{formatEntryDateTime(entry.startedAt)} &nbsp;•&nbsp; {tasks.find((task) => task.id === entry.taskId)?.title ?? "Archived task"}</small></div>
                  <span className="reference-entry-tag">{tasks.find((task) => task.id === entry.taskId)?.tags[0] ?? "Entry"}</span>
                  {aiSuggestion ? <span className="reference-entry-tag is-ai">{getAiSuggestionButtonLabel(aiSuggestion)}</span> : null}
                  <button aria-label="Open entry in main window" onClick={() => void handleOpenMainWindow()}>•••</button>
                </article>;
              })}
            </div>
          </section>

          {error ? <p className="reference-overlay-error">{error}</p> : null}
        </section>
      ) : null}
    </main>
  );
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    chevron: <path d="m6 9 6 6 6-6" />,
    clock: <><circle cx="12" cy="13" r="7" /><path d="M12 9v4l2.5 1.5M9 2h6M12 2v4M5 5 3 7M19 5l2 2" /></>,
    close: <><path d="m7 7 10 10M17 7 7 17" /></>,
    list: <><path d="M9 6h10M9 12h10M9 18h10" /><circle cx="4" cy="6" r=".8" fill="currentColor" /><circle cx="4" cy="12" r=".8" fill="currentColor" /><circle cx="4" cy="18" r=".8" fill="currentColor" /></>,
    note: <><path d="M6 3h9l3 3v15H6zM15 3v4h4M9 12h6M9 16h6" /></>,
    pause: <><path d="M9 6v12M15 6v12" /></>,
    play: <path d="m9 6 8 6-8 6z" fill="currentColor" stroke="none" />,
    search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7.6 7.6 0 0 0-.1-1l2-1.5-2-3.5-2.3.9a7 7 0 0 0-1.7-1L14.5 3h-5L9 5.9a7 7 0 0 0-1.7 1L5 6 3 9.5 5 11a7.6 7.6 0 0 0 0 2l-2 1.5L5 18l2.3-.9a7 7 0 0 0 1.7 1l.5 2.9h5l.4-2.9a7 7 0 0 0 1.7-1l2.3.9 2-3.5-2-1.5c.1-.3.1-.7.1-1Z" /></>,
    stop: <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none" />,
    tag: <><path d="M4 5v7l8 8 8-8-8-8z" /><circle cx="8" cy="9" r="1" fill="currentColor" /></>
  };

  return <svg aria-hidden="true" className="reference-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function readClockMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}
