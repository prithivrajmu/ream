import { type CSSProperties, type MouseEvent, type ReactNode, type KeyboardEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
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
import type { OverlayMode } from "../../shared/overlayBounds";
import type { PreferredOverlayMode } from "../appSettings";
import sharpeiStateSheet from "../assets/sharpei-state-sheet.png";

type IconName = "chevron" | "clock" | "close" | "list" | "maximize" | "minimize" | "note" | "pause" | "play" | "search" | "settings" | "stop" | "tag";

interface OverlayViewProps {
  desktopPetEnabled: boolean;
  themeId: ThemeId;
  overlayTransparency: number;
  preferredOverlayMode: PreferredOverlayMode;
}

interface OverlayAiPreview {
  suggestionId: string;
  activeTimerId: string;
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
const PET_ACTIVATION_DELAY_MS = 3000;
const PET_MESSAGE_DURATION_MS = 1900;
const STOP_CONFIRMATION_THRESHOLD_SECONDS = 10;
const TINY_VIEWPORT_FALLBACK_MAX_WIDTH = 500;
const DEEP_FOCUS_THRESHOLD_SECONDS = 25 * 60;
const DAILY_GOAL_SECONDS = 8 * 60 * 60;
const JUST_COMPLETED_WINDOW_MS = 60 * 1000;

type PetStateId = "timer-running" | "timer-paused" | "no-timer-today" | "deep-focus" | "task-completed" | "idle" | "break-time" | "daily-goal-met";

interface PetSpriteCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

interface PetStateDefinition {
  id: PetStateId;
  label: string;
  mood: string;
  crop: PetSpriteCrop;
  messages: string[];
}

const PET_STATES: Record<PetStateId, PetStateDefinition> = {
  "timer-running": {
    id: "timer-running",
    label: "Timer running",
    mood: "Energetic, alert, cheerful.",
    crop: { x: 20, y: 135, width: 300, height: 330, scale: 0.58 },
    messages: ["I am monitoring productivity. Also crumbs.", "Run, apparently. I support this chaos.", "Fine, we are focused. Try to look natural."]
  },
  "timer-paused": {
    id: "timer-paused",
    label: "Timer paused",
    mood: "Sitting still, slightly puzzled.",
    crop: { x: 370, y: 135, width: 300, height: 330, scale: 0.58 },
    messages: ["Paused? Bold strategy.", "I sat down emotionally and physically.", "Wake me when ambition resumes."]
  },
  "no-timer-today": {
    id: "no-timer-today",
    label: "No timer run today",
    mood: "Slumped, sleepy, low-energy.",
    crop: { x: 660, y: 278, width: 390, height: 210, scale: 0.56 },
    messages: ["A historic absence of timers.", "Nothing tracked. I respect the mystery.", "Today is currently theoretical."]
  },
  "deep-focus": {
    id: "deep-focus",
    label: "Deep focus",
    mood: "Determined, focused, confident.",
    crop: { x: 1060, y: 140, width: 300, height: 330, scale: 0.58 },
    messages: ["Do not disturb the wrinkles.", "We are locked in. I look serious for both of us.", "Deep focus detected. I have tightened my face."]
  },
  "task-completed": {
    id: "task-completed",
    label: "Task completed",
    mood: "Very happy, celebratory, proud.",
    crop: { x: 35, y: 550, width: 300, height: 350, scale: 0.56 },
    messages: ["Acceptable. I will allow one celebration.", "Task done. My paws were instrumental.", "Victory. Try not to make it weird."]
  },
  idle: {
    id: "idle",
    label: "Idle / no active task",
    mood: "Curious, sniffing, looking around.",
    crop: { x: 350, y: 570, width: 330, height: 330, scale: 0.56 },
    messages: ["I am available for vague supervision.", "No active task. Suspiciously peaceful.", "I sniffed the backlog. It sniffed back."]
  },
  "break-time": {
    id: "break-time",
    label: "Break time",
    mood: "Relaxed, stretching, content.",
    crop: { x: 660, y: 680, width: 410, height: 220, scale: 0.54 },
    messages: ["Break approved. Hydrate, tiny legend.", "Stretching is productivity with fewer spreadsheets.", "I scheduled this nap-adjacent pause."]
  },
  "daily-goal-met": {
    id: "daily-goal-met",
    label: "Daily goal met",
    mood: "Cozy, satisfied, sleepy-happy.",
    crop: { x: 1060, y: 680, width: 360, height: 220, scale: 0.56 },
    messages: ["Daily goal met. I am retiring immediately.", "You did it. I will now be insufferably cozy.", "Enough productivity. The wrinkles demand rest."]
  }
};

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

export function OverlayView({ desktopPetEnabled, themeId, overlayTransparency, preferredOverlayMode }: OverlayViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentEntries, setRecentEntries] = useState<TimeEntry[]>([]);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<NoteAiSuggestion[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [taskSearch, setTaskSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState<OverlayAiPreview | null>(null);
  const [petMessage, setPetMessage] = useState<string | null>(null);
  const [petHovered, setPetHovered] = useState(false);
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
  const petVelocityRef = useRef({ dx: 1.4, dy: 0.9, turn: 0 });

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
  const timerState: TimerState = activeTimer ? (isPaused ? "paused" : "running") : "idle";
  const expanded = interactionState.mode === "expanded";
  const shouldRenderTinyOverlay = !expanded && (interactionState.mode === "tiny" || overlayViewportWidth <= TINY_VIEWPORT_FALLBACK_MAX_WIDTH);
  const shouldRenderPetOverlay = !expanded && interactionState.mode === "pet";
  const visualOverlayMode = shouldRenderPetOverlay ? "pet" : shouldRenderTinyOverlay ? "tiny" : interactionState.mode;
  const todayTrackedSeconds = useMemo(() => todayEntries.reduce((total, entry) => total + entry.durationSeconds, 0), [todayEntries]);
  const petState = useMemo(() => {
    if (activeTimer && !isPaused && elapsed >= DEEP_FOCUS_THRESHOLD_SECONDS) {
      return PET_STATES["deep-focus"];
    }

    if (activeTimer && isPaused) {
      return PET_STATES["timer-paused"];
    }

    if (activeTimer) {
      return PET_STATES["timer-running"];
    }

    const latestEntry = todayEntries
      .slice()
      .sort((left, right) => right.endedAt.localeCompare(left.endedAt))[0];
    const latestEndedAt = latestEntry ? new Date(latestEntry.endedAt).getTime() : 0;
    if (latestEndedAt && Date.now() - latestEndedAt < JUST_COMPLETED_WINDOW_MS) {
      return PET_STATES["task-completed"];
    }

    if (todayTrackedSeconds >= DAILY_GOAL_SECONDS) {
      return PET_STATES["daily-goal-met"];
    }

    if (todayEntries.length > 0) {
      return PET_STATES["break-time"];
    }

    if (tasks.length > 0) {
      return PET_STATES.idle;
    }

    return PET_STATES["no-timer-today"];
  }, [activeTimer, elapsed, isPaused, tasks.length, todayEntries, todayTrackedSeconds]);
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
    function syncOverlayViewportWidth() {
      setOverlayViewportWidth(window.innerWidth);
    }

    syncOverlayViewportWidth();
    window.addEventListener("resize", syncOverlayViewportWidth);
    return () => window.removeEventListener("resize", syncOverlayViewportWidth);
  }, []);

  const refreshOverlayState = useCallback(async (syncNote = false) => {
    const [nextTasks, nextProjects, nextActiveTimer, nextRecentEntries, nextTodayEntries, nextAiSuggestions] = await Promise.all([
      listActiveTasks(db),
      listActiveProjects(db),
      getActiveTimer(db),
      db.timeEntries.orderBy("startedAt").reverse().limit(3).toArray(),
      db.timeEntries.where("startedAt").aboveOrEqual(getLocalDayStartIso()).toArray(),
      listNoteAiSuggestions(db)
    ]);

    setTasks(nextTasks);
    setProjects(nextProjects);
    setActiveTimer(nextActiveTimer);
    setRecentEntries(nextRecentEntries);
    setTodayEntries(nextTodayEntries);
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
    const unsubscribeMode = window.reamDesktop?.onOverlayModeChanged?.((mode) => {
      dispatchInteraction({ type: "set-mode", mode });
      if (mode === "default") {
        scheduleAutoCollapse();
      }
    });
    const unsubscribeExpanded = window.reamDesktop?.onOverlayExpandedChanged?.((nextExpanded) => {
      dispatchInteraction({ type: "set-mode", mode: nextExpanded ? "expanded" : "default" });
    });

    const overlayModeRequest = window.reamDesktop?.getOverlayMode?.();
    if (overlayModeRequest) {
      overlayModeRequest.then((mode) => {
        dispatchInteraction({ type: "set-mode", mode });
        if (mode === "default") {
          scheduleAutoCollapse();
        }
      })
        .catch(() => undefined);
    } else {
      scheduleAutoCollapse();
    }

    return () => {
      unsubscribeMode?.();
      unsubscribeExpanded?.();
    };
  }, []);

  useEffect(() => {
    if (!expanded) {
      setNotesExpanded(false);
    }
  }, [expanded]);

  useEffect(() => {
    if (aiPreview && activeTimer?.id !== aiPreview.activeTimerId) {
      setAiPreview(null);
    }
  }, [activeTimer?.id, aiPreview]);

  useEffect(() => {
    if (!desktopPetEnabled || interactionState.mode !== "tiny") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (interactionStateRef.current.mode === "tiny") {
        void setOverlayMode("pet");
      }
    }, PET_ACTIVATION_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [desktopPetEnabled, interactionState.mode]);

  useEffect(() => {
    if (interactionState.mode !== "pet" || petHovered || petMessage) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const velocity = petVelocityRef.current;
      velocity.turn += 1;
      if (velocity.turn > 11) {
        velocity.turn = 0;
        velocity.dx = Math.max(-2.2, Math.min(2.2, velocity.dx + (Math.random() - 0.5) * 1.3));
        velocity.dy = Math.max(-1.6, Math.min(1.6, velocity.dy + (Math.random() - 0.5) * 1.1));
        if (Math.abs(velocity.dx) < 0.7) {
          velocity.dx = velocity.dx < 0 ? -0.9 : 0.9;
        }
      }

      void window.reamDesktop?.movePetOverlay?.({ dx: velocity.dx, dy: velocity.dy });
    }, 140);

    return () => window.clearInterval(intervalId);
  }, [interactionState.mode, petHovered, petMessage]);

  useEffect(() => {
    if (!petMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void setOverlayMode("tiny");
      setPetMessage(null);
    }, PET_MESSAGE_DURATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [petMessage]);

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
    const activeTimerId = activeTimer?.id ?? null;
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

      void setOverlayMode(desktopPetEnabled ? "tiny" : preferredOverlayMode);
    }, AUTO_COLLAPSE_DELAY_MS);
  }

  async function handleOverlayStart() {
    markControlInteraction();
    setError(null);

    try {
      const nextActiveTimer = await startTimer(db, { taskId: selectedTaskId, note });
      setActiveTimer(nextActiveTimer);
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
    }
  }

  async function handlePauseResume() {
    markControlInteraction();
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
    markControlInteraction();
    setError(null);

    try {
      await updateActiveTimerNote(db, note);
      await stopTimer(db);
      setActiveTimer(null);
      setNote("");
      setNoteDirty(false);
      setAiPreview(null);
      dispatchInteraction({ type: "confirm", confirmation: null });
      await refreshOverlayState();
      return true;
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Unable to stop timer.");
      return false;
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
    if (expanded) {
      await setOverlayExpanded(false);
    }

    await window.reamDesktop?.showMainWindow();
  }

  async function handleOpenSettingsWindow() {
    if (expanded) {
      await setOverlayExpanded(false);
    }

    await window.reamDesktop?.showSettingsWindow?.();
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

  function handlePetClick(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    markControlInteraction();
    const messageIndex = Math.floor(Math.random() * petState.messages.length);
    setPetMessage(petState.messages[messageIndex]);
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
    setNoteDirty(true);
    setAiPreview(null);
    setNote((currentNote) => currentNote.includes(`#${tag}`) ? currentNote : `${currentNote}${currentNote ? " " : ""}#${tag}`);
  }

  function handleNoteChange(nextNote: string) {
    setNote(nextNote);
    setNoteDirty(true);
    setAiPreview(null);
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
          aria-label={expanded ? "Collapse overlay" : "Expand overlay"}
          className="reference-expand-button"
          onClick={(event) => {
            stopEvent(event);
            markControlInteraction();
            void setOverlayExpanded(!expanded);
          }}
          type="button"
        >
          <Icon name="chevron" />
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

  function renderPetOverlay() {
    const crop = petState.crop;
    const spriteStyle = {
      "--sprite-left": `${crop.x * crop.scale * -1}px`,
      "--sprite-top": `${crop.y * crop.scale * -1}px`,
      "--sprite-width": `${crop.width * crop.scale}px`,
      "--sprite-height": `${crop.height * crop.scale}px`,
      "--sheet-width": `${1448 * crop.scale}px`
    } as CSSProperties;

    return (
      <button
        aria-label={`Desktop pet: ${petState.label}`}
        className={`pet-sidecar pet-state-${petState.id}`}
        onClick={handlePetClick}
        onMouseEnter={() => setPetHovered(true)}
        onMouseLeave={() => setPetHovered(false)}
        title={`${petState.label} - ${petState.mood}`}
        type="button"
      >
        {petMessage ? <span className="pet-message" role="status">{petMessage}</span> : null}
        <span className="pet-sprite-frame" style={spriteStyle}>
          <img alt="" draggable={false} src={sharpeiStateSheet} />
        </span>
      </button>
    );
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
    if (expanded && !notesExpanded) {
      setNotesExpanded(true);
    }
    setAiLoading(true);

    try {
      if (!window.reamDesktop?.improveNoteWithAi) {
        throw new Error("AI is only available in the desktop app.");
      }

      const projectName = activeTask.projectIds.map((id) => projectById.get(id)?.title).filter(Boolean).join(", ");
      const model = window.localStorage.getItem(OLLAMA_MODEL_STORAGE_KEY)?.trim() || DEFAULT_OLLAMA_MODEL;
      const requestStartedAt = readClockMs();
      const result = await window.reamDesktop.improveNoteWithAi({
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
      const updatedSuggestion = await updateNoteAiSuggestionStatus(db, preview.suggestionId, "accepted");
      setAiSuggestions((current) => current.map((suggestion) => suggestion.id === updatedSuggestion.id ? updatedSuggestion : suggestion));
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
      const updatedSuggestion = await updateNoteAiSuggestionStatus(db, preview.suggestionId, "rejected");
      setAiSuggestions((current) => current.map((suggestion) => suggestion.id === updatedSuggestion.id ? updatedSuggestion : suggestion));
      setAiPreview(null);
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Unable to reject AI suggestion.");
    }
  }

  async function handleCopyAiSuggestion(preview: OverlayAiPreview) {
    setError(null);
    try {
      await navigator.clipboard.writeText(preview.output.clean_note);
      const updatedSuggestion = await updateNoteAiSuggestionStatus(db, preview.suggestionId, "copied");
      setAiSuggestions((current) => current.map((suggestion) => suggestion.id === updatedSuggestion.id ? updatedSuggestion : suggestion));
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
    if (savedSuggestion && (savedSuggestion.status === "accepted" || savedSuggestion.inputText === noteText)) {
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
      {shouldRenderPetOverlay ? renderPetOverlay() : shouldRenderTinyOverlay ? renderTinyOverlay() : interactionState.mode === "mini" ? renderMiniOverlay() : renderDefaultOverlayBar()}

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
                  {(displayTask?.tags ?? []).slice(0, 4).map((tag) => (
                    <button key={tag} onClick={() => handleQuickTag(tag)}><Icon name="tag" />{tag}</button>
                  ))}
                </div>
              </div>
            </section>

            <section className="reference-notes-card">
              <div className="reference-notes-heading">
                <span><Icon name="note" />Task Notes</span>
                <div className="reference-notes-actions">
                  {renderImproveNoteButton()}
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
              <textarea
                aria-label="Task notes"
                placeholder="Write your notes here..."
                value={note}
                onChange={(event) => handleNoteChange(event.target.value)}
              />
              {aiPreview ? (
                <div className="reference-ai-preview">
                  <section className="reference-ai-preview-panel">
                    <h3>Raw note</h3>
                    <div className="reference-ai-preview-body">
                      <p>{aiPreview.rawNote}</p>
                    </div>
                  </section>
                  <section className="reference-ai-preview-panel is-suggestion">
                    <h3>AI suggestion</h3>
                    <div className="reference-ai-preview-body">
                      <p>{aiPreview.output.clean_note}</p>
                      <dl>
                        <div><dt>Summary</dt><dd>{aiPreview.output.summary}</dd></div>
                        <div><dt>Next steps</dt><dd>{aiPreview.output.next_steps.length ? aiPreview.output.next_steps.join("; ") : "None"}</dd></div>
                        <div><dt>Blockers</dt><dd>{aiPreview.output.blockers.length ? aiPreview.output.blockers.join("; ") : "None"}</dd></div>
                        <div><dt>Tags</dt><dd>{aiPreview.output.tags.length ? aiPreview.output.tags.join(", ") : "None"}</dd></div>
                      </dl>
                      <small>Model: {aiPreview.model}</small>
                    </div>
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

function getLocalDayStartIso(now = new Date()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}
