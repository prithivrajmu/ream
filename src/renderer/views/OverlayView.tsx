import { type CSSProperties, type MouseEvent, type ReactNode, type KeyboardEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { liveQuery } from "dexie";
import { DEFAULT_OLLAMA_MODEL, formatImprovedNoteMarkdown, OLLAMA_MODEL_STORAGE_KEY, type ImprovedNoteOutput, validateImprovedNoteOutput } from "../../shared/ai";
import { acceptActiveTimerAiSuggestion, createActiveTimerAiSuggestion, listNoteAiSuggestions, timerAiNoteId, updateNoteAiSuggestionStatus } from "../../shared/aiSuggestionRepository";
import { readWorkspaceRevision } from "../../shared/workspaceRepository";
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
import { buildOverlayProjectTagLabels } from "../overlayUtils";
import { readAppSettings } from "../appSettings";
import { formatEntryDateTime } from "../rendererUtils";
import { MarkdownNoteEditor, type MarkdownNoteEditorHandle } from "../notes/MarkdownNoteEditor";
import { useAutosavedNote } from "../notes/useAutosavedNote";
import { NoteConflictNotice } from "../notes/NoteConflictNotice";
import { LiveAiNotePreview } from "../notes/LiveAiNotePreview";
import { applyLiveAiNote } from "../notes/applyLiveAiNote";
import { clearNoteRecoveryDraft, readNoteRecoveryDraft, writeNoteRecoveryDraft } from "../notes/noteDrafts";
import { RichNoteView } from "../richNotes";
import type { ThemeId } from "../themeOptions";
import type { OverlayMode } from "../../shared/overlayBounds";

type IconName = "chevron" | "clock" | "close" | "list" | "maximize" | "minimize" | "note" | "pause" | "play" | "search" | "settings" | "stop" | "tag";

interface OverlayViewProps {
  themeId: ThemeId;
  overlayTransparency: number;
}

interface OverlayAiPreview {
  suggestionId: string;
  activeTimerId: string;
  workspaceRevision: number;
  model: string;
  rawNote: string;
  output: ImprovedNoteOutput;
}

type TimerState = "idle" | "running" | "paused" | "stopped";

interface OverlayInteractionState {
  mode: OverlayMode;
  isHovered: boolean;
  isDragging: boolean;
  confirmation: null | "stop";
  contextMenuOpen: boolean;
  lastControlInteractionAt: number;
}

type OverlayInteractionAction =
  | { type: "set-mode"; mode: OverlayMode }
  | { type: "hover"; hovered: boolean }
  | { type: "dragging"; dragging: boolean }
  | { type: "confirm"; confirmation: null | "stop" }
  | { type: "context-menu"; open: boolean }
  | { type: "control-interaction"; now: number };

const AUTO_COLLAPSE_DELAY_MS = 6000;
const STOP_CONFIRMATION_THRESHOLD_SECONDS = 10;
const TINY_VIEWPORT_FALLBACK_MAX_WIDTH = 500;

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function overlayInteractionReducer(state: OverlayInteractionState, action: OverlayInteractionAction): OverlayInteractionState {
  if (action.type === "set-mode") {
    return { ...state, mode: action.mode };
  }

  if (action.type === "hover") {
    return { ...state, isHovered: action.hovered };
  }

  if (action.type === "dragging") {
    return { ...state, isDragging: action.dragging };
  }

  if (action.type === "confirm") {
    return { ...state, confirmation: action.confirmation };
  }

  if (action.type === "context-menu") {
    return { ...state, contextMenuOpen: action.open };
  }

  return { ...state, lastControlInteractionAt: action.now };
}

export function OverlayView({ themeId, overlayTransparency }: OverlayViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentEntries, setRecentEntries] = useState<TimeEntry[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<NoteAiSuggestion[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [pendingNote, setPendingNote] = useState("");
  const timerStartedAt = activeTimer?.startedAt ?? "";
  const saveTimerNote = useCallback((value: string, expectedValue: string) => updateActiveTimerNote(db, value, new Date(), timerStartedAt, expectedValue), [timerStartedAt]);
  const timerDraft = useAutosavedNote(`timer:${timerStartedAt}`, activeTimer?.note ?? "", saveTimerNote, Boolean(activeTimer));
  const note = activeTimer ? timerDraft.value : pendingNote;
  const noteSaveStatus = activeTimer ? timerDraft.status : "idle";
  const [elapsed, setElapsed] = useState(0);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [taskSearch, setTaskSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiActionBusy, setAiActionBusy] = useState(false);
  const aiActionBusyRef = useRef(false);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [aiPreview, setAiPreview] = useState<OverlayAiPreview | null>(null);
  const [overlayViewportWidth, setOverlayViewportWidth] = useState(() => window.innerWidth);
  const [interactionState, dispatchInteraction] = useReducer(overlayInteractionReducer, {
    mode: "default",
    isHovered: false,
    isDragging: false,
    confirmation: null,
    contextMenuOpen: false,
    lastControlInteractionAt: 0
  });
  const autoCollapseTimeoutRef = useRef<number | null>(null);
  const previousTimerIdRef = useRef<string | null>(null);
  const interactionStateRef = useRef(interactionState);
  const noteEditorRef = useRef<MarkdownNoteEditorHandle | null>(null);
  const activeTimerRef = useRef<ActiveTimer | null>(null);
  const noteRef = useRef(note);
  const taskSearchRef = useRef<HTMLInputElement | null>(null);
  const timerActionRef = useRef(false);

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
  const projectTagLabels = useMemo(() => buildOverlayProjectTagLabels(projects, displayTask), [displayTask, projects]);
  const noteContextId = activeTimer ? `timer:${activeTimer.startedAt}` : (selectedTaskId ? `pending-${selectedTaskId}` : null);
  const isPaused = Boolean(activeTimer?.pausedAt);
  const timerState: TimerState = activeTimer ? (isPaused ? "paused" : "running") : "idle";
  const expanded = interactionState.mode === "expanded";
  const shouldRenderTinyOverlay = !expanded && (interactionState.mode === "tiny" || (interactionState.mode !== "mini" && overlayViewportWidth <= TINY_VIEWPORT_FALLBACK_MAX_WIDTH));
  const visualOverlayMode = shouldRenderTinyOverlay ? "tiny" : interactionState.mode;
  const filteredTasks = useMemo(() => {
    const query = taskSearch.trim().toLocaleLowerCase();
    if (!query) {
      return tasks;
    }
    return tasks.filter((task) => `${task.title} ${task.tags.join(" ")}`.toLocaleLowerCase().includes(query));
  }, [taskSearch, tasks]);

  useEffect(() => {
    interactionStateRef.current = interactionState;
  }, [interactionState]);

  useEffect(() => {
    activeTimerRef.current = activeTimer;
  }, [activeTimer]);

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  useEffect(() => {
    function syncOverlayViewportWidth() {
      setOverlayViewportWidth(window.innerWidth);
    }

    syncOverlayViewportWidth();
    window.addEventListener("resize", syncOverlayViewportWidth);
    return () => window.removeEventListener("resize", syncOverlayViewportWidth);
  }, []);

  useEffect(() => {
    const focusTaskSearch = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      dispatchInteraction({ type: "set-mode", mode: "expanded" });
      void window.reamDesktop?.setOverlayMode?.("expanded").catch(() => undefined);
      window.setTimeout(() => taskSearchRef.current?.focus(), 0);
    };
    document.addEventListener("keydown", focusTaskSearch);
    return () => document.removeEventListener("keydown", focusTaskSearch);
  }, []);

  const refreshOverlayState = useCallback(async () => {
    const [nextTasks, nextProjects, nextActiveTimer, nextRecentEntries, nextAiSuggestions, nextRevision] = await db.transaction("r", db.tables, () => Promise.all([
      listActiveTasks(db),
      listActiveProjects(db),
      getActiveTimer(db),
      db.timeEntries.orderBy("startedAt").reverse().limit(3).toArray(),
      listNoteAiSuggestions(db),
      readWorkspaceRevision(db)
    ]));

    setWorkspaceRevision(nextRevision);
    setTasks(nextTasks);
    setProjects(nextProjects);
    setActiveTimer(nextActiveTimer);
    setRecentEntries(nextRecentEntries);
    setAiSuggestions(nextAiSuggestions);

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
    const subscription = liveQuery(refreshOverlayState).subscribe({
      error: (refreshError: unknown) => {
        setError(refreshError instanceof Error ? refreshError.message : "Unable to load overlay data.");
      }
    });
    return () => subscription.unsubscribe();
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
    const unsubscribeMode = window.reamDesktop?.onOverlayModeChanged?.((mode) => {
      dispatchInteraction({ type: "set-mode", mode });
      if (mode === "default") {
        scheduleAutoCollapse();
      }
    });
    // The legacy expanded event also fires for mini/tiny and would reset them
    // to default. The mode event is the complete source of window state.

    window.reamDesktop?.getOverlayMode?.()
      .then((mode) => {
        dispatchInteraction({ type: "set-mode", mode });
        if (mode === "default") {
          scheduleAutoCollapse();
        }
      })
      .catch(() => undefined);

    return () => {
      unsubscribeMode?.();
    };
  }, []);

  useEffect(() => {
    if (!expanded) {
      setNotesExpanded(false);
    }
  }, [expanded]);

  useEffect(() => {
    return window.reamDesktop?.onQuickNoteRequested?.(() => {
      setNotesExpanded(true);
      void setOverlayExpanded(true);
      window.setTimeout(() => noteEditorRef.current?.focus(), 80);
    });
  }, []);

  useEffect(() => {
    if (aiPreview && activeTimer?.startedAt !== aiPreview.activeTimerId) {
      setAiPreview(null);
    }
  }, [activeTimer?.startedAt, aiPreview]);

  useEffect(() => {
    if (!noteContextId || activeTimer) {
      return;
    }

    const recoveryDraft = readNoteRecoveryDraft(window.localStorage, noteContextId);
    setPendingNote(recoveryDraft?.markdown ?? selectedTask?.defaultNote ?? "");
    setAiPreview(null);
  }, [noteContextId, activeTimer, selectedTask?.defaultNote]);

  useEffect(() => {
    return window.reamDesktop?.onOverlayContextCommand?.((command) => {
      dispatchInteraction({ type: "context-menu", open: false });

      if (command === "mini") {
        void setOverlayMode("default");
        return;
      }

      if (command === "default") {
        void setOverlayMode("default");
        return;
      }

      if (command === "pause-resume") {
        void handlePauseResume();
        return;
      }

      if (command === "stop") {
        void handleStopRequest();
        return;
      }

      if (command === "settings") {
        void handleOpenSettingsWindow();
      }
    });
  });

  useEffect(() => {
    const activeTimerId = activeTimer?.startedAt ?? null;
    if (activeTimerId && previousTimerIdRef.current !== activeTimerId) {
      void setOverlayMode("default");
      scheduleAutoCollapse();
    }
    previousTimerIdRef.current = activeTimerId;
  });

  useEffect(() => {
    return () => {
      if (autoCollapseTimeoutRef.current) {
        window.clearTimeout(autoCollapseTimeoutRef.current);
      }
    };
  }, []);

  async function setOverlayMode(mode: OverlayMode) {
    if (mode !== "tiny") {
      await window.reamDesktop?.setOverlayMode?.(mode);
      dispatchInteraction({ type: "set-mode", mode });
      if (mode === "default") {
        scheduleAutoCollapse();
      }
      return;
    }

    dispatchInteraction({ type: "set-mode", mode });
    await waitForNextPaint();
    await window.reamDesktop?.setOverlayMode?.(mode);
  }

  async function setOverlayExpanded(nextExpanded: boolean) {
    if (nextExpanded && autoCollapseTimeoutRef.current) {
      window.clearTimeout(autoCollapseTimeoutRef.current);
      autoCollapseTimeoutRef.current = null;
    }
    await setOverlayMode(nextExpanded ? "expanded" : "default");
  }

  async function flushActiveTimerNote() {
    await timerDraft.flush();
  }

  function markControlInteraction() {
    dispatchInteraction({ type: "control-interaction", now: Date.now() });
  }

  function scheduleAutoCollapse() {
    if (autoCollapseTimeoutRef.current) {
      window.clearTimeout(autoCollapseTimeoutRef.current);
    }

    autoCollapseTimeoutRef.current = window.setTimeout(() => {
      const currentInteractionState = interactionStateRef.current;
      if (currentInteractionState.mode !== "default") {
        autoCollapseTimeoutRef.current = null;
        return;
      }

      const overlayTextInputHasFocus = isTextInputTarget(document.activeElement);
      if (currentInteractionState.isHovered || currentInteractionState.isDragging || overlayTextInputHasFocus) {
        scheduleAutoCollapse();
        return;
      }

      if (currentInteractionState.confirmation) {
        autoCollapseTimeoutRef.current = null;
        return;
      }

      void setOverlayMode(readAppSettings().preferredOverlayMode === "mini" ? "mini" : "tiny");
    }, AUTO_COLLAPSE_DELAY_MS);
  }

  async function handleOverlayStart() {
    if (timerActionRef.current) return;
    timerActionRef.current = true;
    markControlInteraction();
    setError(null);

    try {
      const nextActiveTimer = await startTimer(db, { taskId: selectedTaskId, note });
      setActiveTimer(nextActiveTimer);
      activeTimerRef.current = nextActiveTimer;
      noteRef.current = nextActiveTimer.note;
      setPendingNote("");
      clearNoteRecoveryDraft(window.localStorage, `pending-${selectedTaskId}`);
      setAiPreview(null);
      setElapsed(0);
      if (expanded) {
        await setOverlayExpanded(true);
        return;
      }
      await setOverlayMode("default");
      scheduleAutoCollapse();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Unable to start timer.");
    } finally {
      timerActionRef.current = false;
    }
  }

  async function handlePauseResume() {
    markControlInteraction();
    if (!activeTimer || timerActionRef.current) {
      return;
    }
    timerActionRef.current = true;
    setError(null);
    try {
      await flushActiveTimerNote();
      const updated = activeTimer.pausedAt ? await resumeTimer(db) : await pauseTimer(db);
      setActiveTimer(updated);
      activeTimerRef.current = updated;
      setElapsed(activeTimerElapsedSeconds(updated));
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "Unable to update timer.");
    } finally {
      timerActionRef.current = false;
    }
  }

  async function handleOverlayStop(): Promise<boolean> {
    if (!activeTimer || timerActionRef.current) return false;
    timerActionRef.current = true;
    markControlInteraction();
    setError(null);

    try {
      await flushActiveTimerNote();
      await stopTimer(db, new Date(), activeTimer.startedAt);
      setActiveTimer(null);
      activeTimerRef.current = null;
      setPendingNote("");
      setAiPreview(null);
      dispatchInteraction({ type: "confirm", confirmation: null });
      await refreshOverlayState();
      return true;
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Unable to stop timer.");
      return false;
    } finally {
      timerActionRef.current = false;
    }
  }

  async function handleStopRequest() {
    markControlInteraction();
    if (!activeTimer) {
      return;
    }

    if (elapsed < STOP_CONFIRMATION_THRESHOLD_SECONDS) {
      await handleOverlayStop();
      return;
    }

    if (interactionState.mode === "mini" || interactionState.mode === "tiny") {
      await setOverlayMode("default");
    }
    dispatchInteraction({ type: "confirm", confirmation: "stop" });
  }

  function handleCancelStop() {
    markControlInteraction();
    dispatchInteraction({ type: "confirm", confirmation: null });
  }

  async function handleCompleteEntry() {
    if (await handleOverlayStop()) {
      await setOverlayExpanded(false);
    }
  }

  async function handleOpenMainWindow() {
    try {
      await flushActiveTimerNote();
    if (expanded) {
      await setOverlayExpanded(false);
    }

    await window.reamDesktop?.showMainWindow();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save note. Please retry.");
    }
  }

  async function handleOpenSettingsWindow() {
    try {
      await flushActiveTimerNote();
    if (expanded) {
      await setOverlayExpanded(false);
    }

    await window.reamDesktop?.showSettingsWindow?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save note. Please retry.");
    }
  }

  function stopEvent(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function isControlTarget(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest("button,input,select,textarea,a,[data-overlay-control='true']"));
  }

  function handlePointerDown(event: MouseEvent<HTMLElement>) {
    if (!isControlTarget(event.target)) {
      dispatchInteraction({ type: "dragging", dragging: true });
    }
  }

  function handlePointerUp() {
    dispatchInteraction({ type: "dragging", dragging: false });
  }

  function handleOverlayMouseEnter() {
    dispatchInteraction({ type: "hover", hovered: true });
    if (interactionStateRef.current.mode === "tiny") {
      void setOverlayMode("default");
    }
  }

  function handleTinyClick(event: MouseEvent<HTMLElement>) {
    if (!isControlTarget(event.target)) {
      void setOverlayMode("default");
    }
  }

  function handleOverlayMouseMove() {
    if (interactionStateRef.current.mode === "tiny") {
      void setOverlayMode("default");
    }
  }

  function handleMiniClick(event: MouseEvent<HTMLElement>) {
    if (!isControlTarget(event.target)) {
      void setOverlayMode("default");
    }
  }

  function handleTinyContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    markControlInteraction();
    dispatchInteraction({ type: "context-menu", open: true });
    void window.reamDesktop?.showOverlayContextMenu?.({ timerState });
  }

  function handleOverlayKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      if (interactionState.confirmation) {
        event.preventDefault();
        handleCancelStop();
        return;
      }

      if (interactionState.mode === "default") {
        event.preventDefault();
        void setOverlayMode("tiny");
        return;
      }

      if (interactionState.mode === "mini") {
        event.preventDefault();
        void setOverlayMode("tiny");
      }
      return;
    }

    if (event.key === " " && activeTimer && !isTextInputTarget(event.target)) {
      event.preventDefault();
      void handlePauseResume();
    }
  }

  function isTextInputTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return Boolean(target.closest("input,textarea,select,[contenteditable='true']"));
  }

  function handleQuickTag(tag: string) {
    const nextNote = note.includes(`#${tag}`) ? note : `${note}${note ? " " : ""}#${tag}`;
    handleNoteChange(nextNote);
  }

  function handleNoteChange(nextNote: string) {
    noteRef.current = nextNote;
    if (activeTimerRef.current) {
      timerDraft.change(nextNote);
    } else {
      setPendingNote(nextNote);
      if (selectedTaskId) writeNoteRecoveryDraft(window.localStorage, `pending-${selectedTaskId}`, nextNote);
    }
    // Keep the preview available to copy; changed source text disables Accept.
  }

  function handleSelectedTaskChange(nextTaskId: string) {
    if (!activeTimerRef.current && selectedTaskId && noteRef.current) {
      writeNoteRecoveryDraft(window.localStorage, `pending-${selectedTaskId}`, noteRef.current);
    }

    setSelectedTaskId(nextTaskId);
    setAiPreview(null);
    const pendingDraft = readNoteRecoveryDraft(window.localStorage, `pending-${nextTaskId}`);
    const nextTask = tasks.find((task) => task.id === nextTaskId);
    const nextNote = pendingDraft?.markdown ?? nextTask?.defaultNote ?? "";
    noteRef.current = nextNote;
    setPendingNote(nextNote);
  }

  function renderStopConfirmation() {
    if (interactionState.confirmation !== "stop") {
      return null;
    }

    return (
      <div className="reference-stop-confirmation" data-overlay-control="true" role="alertdialog" aria-label="End timer session">
        <span>End?</span>
        <button autoFocus onClick={handleCancelStop} type="button">No</button>
        <button className="danger" onClick={() => void handleOverlayStop()} type="button">End</button>
      </div>
    );
  }

  function renderDefaultOverlayBar() {
    return (
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
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          className="reference-expand-button"
          onClick={(event) => {
            stopEvent(event);
            markControlInteraction();
            void setOverlayExpanded(!expanded);
          }}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          type="button"
        >
          <Icon name={expanded ? "minimize" : "maximize"} />
        </button>

        <div className="reference-overlay-actions" data-overlay-control="true">
          <strong>{formatDuration(elapsed)}</strong>
          {renderStopConfirmation() ?? (activeTimer ? (
            <>
              <button aria-label={isPaused ? "Resume timer" : "Pause timer"} className="reference-icon-button pause" onClick={(event) => {
                stopEvent(event);
                void handlePauseResume();
              }} type="button">
                <Icon name={isPaused ? "play" : "pause"} />
              </button>
              <button aria-label="Stop timer" className="reference-icon-button stop" onClick={(event) => {
                stopEvent(event);
                void handleStopRequest();
              }} type="button">
                <Icon name="stop" />
              </button>
            </>
          ) : (
            <button aria-label="Start timer" className="reference-start-button" disabled={!selectedTaskId} onClick={(event) => {
              stopEvent(event);
              void handleOverlayStart();
            }} type="button">Start</button>
          ))}
          {interactionState.confirmation ? null : (
            <>
              <button aria-label="Open settings" className="reference-plain-button" onClick={(event) => {
                stopEvent(event);
                markControlInteraction();
                void handleOpenSettingsWindow();
              }} type="button">
                <Icon name="settings" />
              </button>
              <button aria-label="Close overlay and show main window" className="reference-plain-button" onClick={(event) => {
                stopEvent(event);
                markControlInteraction();
                void handleOpenMainWindow();
              }} type="button">
                <Icon name="close" />
              </button>
            </>
          )}
        </div>
      </header>
    );
  }

  function renderMiniOverlay() {
    const showStop = Boolean(activeTimer) && (interactionState.isHovered || isPaused);

    return (
      <div
        aria-label="Mini overlay"
        className={`transition-overlay-pill transition-overlay-pill-compact reference-overlay-mini ${showStop ? "has-stop" : ""} ${isPaused ? "is-paused" : ""}`}
        onClick={handleMiniClick}
        title={displayTask ? `${displayTask.title} - ${activeTimer ? (isPaused ? "Paused" : "Tracking") : "Ready"}` : "Start tracking"}
      >
        <span className={`transition-status-dot ${isPaused ? "is-paused" : ""}`} />
        <span className="transition-task-name">{displayTask?.title ?? "Start tracking"}</span>
        <span className="transition-divider" />
        <strong className="transition-timer">{formatDuration(elapsed)}</strong>
        {activeTimer ? (
          <button className="transition-control transition-pause" aria-label={isPaused ? "Resume timer" : "Pause timer"} onClick={(event) => {
            stopEvent(event);
            void handlePauseResume();
          }} type="button">
            <Icon name={isPaused ? "play" : "pause"} />
          </button>
        ) : (
          <button className="transition-control transition-pause" aria-label="Start timer" disabled={!selectedTaskId} onClick={(event) => {
            stopEvent(event);
            void handleOverlayStart();
          }} type="button">
            <Icon name="play" />
          </button>
        )}
        {showStop ? (
          <button className="transition-control transition-stop" aria-label="Stop timer" onClick={(event) => {
            stopEvent(event);
            void handleStopRequest();
          }} type="button">
            <Icon name="stop" />
          </button>
        ) : null}
        <button className="transition-control transition-chevron" aria-label="Show default overlay" onClick={(event) => {
          stopEvent(event);
          markControlInteraction();
          void setOverlayMode("default");
        }} type="button">
          <Icon name="chevron" />
        </button>
      </div>
    );
  }

  function renderTinyOverlay() {
    return (
      <div
        aria-label="Tiny overlay"
        className="transition-overlay-pill transition-overlay-pill-tiny reference-overlay-tiny"
        onClick={handleTinyClick}
        onContextMenu={handleTinyContextMenu}
        title={displayTask ? `${displayTask.title} - ${activeTimer ? (isPaused ? "Paused" : "Tracking") : "Ready"}` : "Start tracking"}
      >
        <span className={`transition-status-dot ${isPaused ? "is-paused" : ""}`} />
        <strong className="transition-timer">{formatDuration(elapsed)}</strong>
        <button className="transition-control transition-chevron" aria-label="Show default overlay" onClick={(event) => {
          stopEvent(event);
          markControlInteraction();
          void setOverlayMode("default");
        }} type="button">
          <Icon name="chevron" />
        </button>
      </div>
    );
  }

  async function handleImproveOverlayNote() {
    if (aiActionBusyRef.current) return;
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
    if (expanded && !notesExpanded) {
      setNotesExpanded(true);
    }
    setAiLoading(true);
    aiActionBusyRef.current = true;
    setAiActionBusy(true);

    try {
      if (!window.reamDesktop?.improveNoteWithAi) {
        throw new Error("AI is only available in the desktop app.");
      }
      await timerDraft.flush();
      const sourceNote = timerDraft.getSnapshot().value;
      if (!sourceNote.trim()) throw new Error("Write a note before using AI.");

      const projectName = activeTask.projectIds.map((id) => projectById.get(id)?.title).filter(Boolean).join(", ");
      const model = window.localStorage.getItem(OLLAMA_MODEL_STORAGE_KEY)?.trim() || DEFAULT_OLLAMA_MODEL;
      const requestStartedAt = readClockMs();
      const result = await window.reamDesktop.improveNoteWithAi({
        noteText: sourceNote,
        taskTitle: activeTask.title,
        projectName,
        tags: activeTask.tags,
        model
      });
      const durationMs = readClockMs() - requestStartedAt;
      const savedSuggestion = await createActiveTimerAiSuggestion(db, {
        model: result.model,
        inputText: sourceNote,
        outputJson: result.output,
        durationMs
      }, { startedAt: activeTimer.startedAt, workspaceRevision });

      setAiPreview({
        suggestionId: savedSuggestion.id,
        activeTimerId: activeTimer.startedAt,
        workspaceRevision,
        model: result.model,
        rawNote: sourceNote,
        output: result.output
      });
    } catch (improveError) {
      setError(improveError instanceof Error ? improveError.message : "Unable to improve note with AI.");
    } finally {
      setAiLoading(false);
      aiActionBusyRef.current = false;
      setAiActionBusy(false);
    }
  }

  async function handleAcceptAiSuggestion(preview: OverlayAiPreview) {
    if (aiActionBusyRef.current) return;
    if (!activeTimer || activeTimer.startedAt !== preview.activeTimerId) {
      setError("The active timer changed. Reject this suggestion and run AI again.");
      return;
    }

    if (!window.confirm("Replace this live note with the full formatted AI rewrite? The original raw note will remain stored with the AI record.")) {
      return;
    }

    setError(null);
    aiActionBusyRef.current = true;
    setAiActionBusy(true);
    try {
      const { suggestion: updatedSuggestion } = await applyLiveAiNote(timerDraft, preview.rawNote, formatImprovedNoteMarkdown(preview.output), () => acceptActiveTimerAiSuggestion(db, preview.suggestionId, { startedAt: preview.activeTimerId, workspaceRevision: preview.workspaceRevision }));
      setAiSuggestions((current) => current.map((suggestion) => suggestion.id === updatedSuggestion.id ? updatedSuggestion : suggestion));
      setAiPreview(null);
      await refreshOverlayState();
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Unable to accept AI suggestion.");
    } finally {
      aiActionBusyRef.current = false;
      setAiActionBusy(false);
    }
  }

  async function handleRejectAiSuggestion(preview: OverlayAiPreview) {
    if (aiActionBusyRef.current) return;
    aiActionBusyRef.current = true;
    setAiActionBusy(true);
    setError(null);
    try {
      const updatedSuggestion = await updateNoteAiSuggestionStatus(db, preview.suggestionId, "rejected");
      setAiSuggestions((current) => current.map((suggestion) => suggestion.id === updatedSuggestion.id ? updatedSuggestion : suggestion));
      setAiPreview(null);
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Unable to reject AI suggestion.");
    } finally {
      aiActionBusyRef.current = false;
      setAiActionBusy(false);
    }
  }

  async function handleCopyAiSuggestion(preview: OverlayAiPreview) {
    if (aiActionBusyRef.current) return;
    aiActionBusyRef.current = true;
    setAiActionBusy(true);
    setError(null);
    try {
      await window.reamDesktop?.focusOverlayWindow?.();
      await navigator.clipboard.writeText(formatImprovedNoteMarkdown(preview.output));
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "Unable to copy AI suggestion.");
      aiActionBusyRef.current = false;
      setAiActionBusy(false);
      return;
    }
    try {
      const updatedSuggestion = await updateNoteAiSuggestionStatus(db, preview.suggestionId, "copied");
      setAiSuggestions((current) => current.map((suggestion) => suggestion.id === updatedSuggestion.id ? updatedSuggestion : suggestion));
    } catch (statusError) {
      console.error("Failed to record AI suggestion copy status", statusError);
    } finally {
      aiActionBusyRef.current = false;
      setAiActionBusy(false);
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
    const savedSuggestion = aiSuggestionByNoteId.get(timerAiNoteId({ startedAt: activeTimer.startedAt, workspaceRevision }));
    if (savedSuggestion && (savedSuggestion.status === "accepted" || savedSuggestion.inputText === note)) {
      return <button className="reference-ai-button is-muted" disabled={aiActionBusy} onClick={() => void handleOpenSavedAiSuggestion({
        suggestionId: savedSuggestion.id,
        activeTimerId: activeTimer.startedAt,
        workspaceRevision,
        model: savedSuggestion.model,
        rawNote: savedSuggestion.inputText,
        output: validateImprovedNoteOutput(savedSuggestion.outputJson)
      })}>{getAiSuggestionButtonLabel(savedSuggestion)}</button>;
    }

    return (
      <button
        className="reference-ai-button"
        disabled={!noteText || aiActionBusy}
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
    <main
      className={`overlay-shell reference-overlay-shell theme-${themeId} mode-${visualOverlayMode} ${expanded ? "is-expanded" : ""} ${notesExpanded ? "is-notes-expanded" : ""}`}
      style={{ "--overlay-opacity": overlayTransparency } as CSSProperties}
      aria-label="Ream overlay"
      onKeyDown={handleOverlayKeyDown}
      onMouseDown={handlePointerDown}
      onMouseEnter={handleOverlayMouseEnter}
      onMouseMove={handleOverlayMouseMove}
      onMouseLeave={() => {
        dispatchInteraction({ type: "hover", hovered: false });
        dispatchInteraction({ type: "dragging", dragging: false });
        if (interactionStateRef.current.mode === "default") {
          scheduleAutoCollapse();
        }
      }}
      onMouseUp={handlePointerUp}
      tabIndex={0}
    >
      {shouldRenderTinyOverlay ? renderTinyOverlay() : interactionState.mode === "mini" ? renderMiniOverlay() : renderDefaultOverlayBar()}

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
                  onChange={(event) => handleSelectedTaskChange(event.target.value)}
                >
                  {tasks.length === 0 ? <option value="">Create a task in the main window</option> : null}
                  {filteredTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </select>
                <Icon name="chevron" />
              </div>
              <label className="reference-search" aria-label="Search tasks">
                <Icon name="search" />
                <input ref={taskSearchRef} value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search tasks..." />
                <kbd>⌘K</kbd>
              </label>
            </div>
          </div>

          <div className={`reference-workspace ${notesExpanded ? "is-notes-expanded" : ""}`}>
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
                <p>Project Tags</p>
                <div>
                  {projectTagLabels.map((label) => (
                    <button key={label} onClick={() => handleQuickTag(label)}><Icon name="tag" />{label}</button>
                  ))}
                </div>
              </div>
            </section>

            <section className="reference-notes-card">
              <div className="reference-notes-heading">
                <span><Icon name="note" />Notes</span>
                <div className="reference-notes-actions">
                  <button
                    aria-label={notesExpanded ? "Restore notes layout" : "Expand notes"}
                    aria-pressed={notesExpanded}
                    className="reference-note-expand-button"
                    onClick={() => setNotesExpanded((current) => !current)}
                    title={notesExpanded ? "Restore notes layout" : "Expand notes"}
                    type="button"
                  >
                    <Icon name={notesExpanded ? "minimize" : "maximize"} />
                  </button>
                </div>
              </div>
              <MarkdownNoteEditor
                key={noteContextId}
                aiAction={renderImproveNoteButton()}
                disabledAi={!activeTimer || aiActionBusy || !note.trim()}
                metadata={[
                  projectTagLabels.join(", ") || "No project",
                  activeTimer ? formatDuration(elapsed) : "No active timer",
                  activeTimer ? formatEntryDateTime(activeTimer.startedAt) : "Ready to start"
                ]}
                onChange={handleNoteChange}
                onImproveWithAi={handleImproveOverlayNote}
                ref={noteEditorRef}
                saveStatus={noteSaveStatus}
                showToolbar={notesExpanded}
                taskTitle={displayTask?.title ?? "Select a task"}
                value={note}
              />
              {noteSaveStatus === "failed" ? <p className="reference-error" role="alert">Note not saved. <button onClick={() => void timerDraft.flush().catch(() => undefined)} type="button">Retry save</button></p> : null}
              <NoteConflictNotice localValue={timerDraft.value} savedValue={timerDraft.conflictValue} onResolve={timerDraft.resolveConflict} />
              {aiPreview ? <LiveAiNotePreview
                rawNote={aiPreview.rawNote}
                output={aiPreview.output}
                model={aiPreview.model}
                localNote={note}
                savedNote={activeTimer?.note ?? ""}
                sessionChanged={aiPreview.activeTimerId !== activeTimer?.startedAt || aiPreview.workspaceRevision !== workspaceRevision}
                busy={aiActionBusy}
                onAccept={() => void handleAcceptAiSuggestion(aiPreview)}
                onCopy={() => void handleCopyAiSuggestion(aiPreview)}
                onReject={() => void handleRejectAiSuggestion(aiPreview)}
                onRegenerate={() => void handleImproveOverlayNote()}
              /> : null}
            </section>
          </div>

          <section className="reference-recent-notes">
            <div className="reference-recent-heading"><h2>Recent Notes</h2><button onClick={() => void handleOpenMainWindow()}>View all <Icon name="chevron" /></button></div>
            <div className="reference-recent-list">
              {recentEntries.length === 0 ? <p>No completed entries yet.</p> : recentEntries.map((entry) => {
                const aiSuggestion = aiSuggestionByNoteId.get(entry.id);
                const task = tasks.find((candidate) => candidate.id === entry.taskId);
                const projectLabel = getEntryProjectLabel(entry, task, projectById);
                return <article key={entry.id}>
                  <span className="reference-entry-icon"><Icon name="note" /></span>
                  <div>{entry.note ? <RichNoteView className="reference-recent-note-rich" text={entry.note} /> : <p>No note added</p>}<small>{formatEntryDateTime(entry.startedAt)} &nbsp;•&nbsp; {task?.title ?? "Archived task"}</small></div>
                  <span className="reference-entry-tag">{projectLabel}</span>
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
    maximize: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" /><path d="M3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6" /></>,
    minimize: <><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /></>,
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

function getEntryProjectLabel(entry: TimeEntry, task: Task | null | undefined, projectById: Map<string, Project>): string {
  const projectIds = entry.projectIds.length ? entry.projectIds : task?.projectIds ?? [];
  const projectNames = projectIds.map((id) => projectById.get(id)?.title).filter((title): title is string => Boolean(title));
  return projectNames[0] ?? "No project";
}
