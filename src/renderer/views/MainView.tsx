import { Fragment, type CSSProperties, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_OLLAMA_MODEL, FALLBACK_OLLAMA_MODEL, OLLAMA_MODEL_STORAGE_KEY, type ImprovedNoteOutput, validateImprovedNoteOutput } from "../../shared/ai";
import { createNoteAiSuggestion, listNoteAiSuggestions, updateNoteAiSuggestionStatus } from "../../shared/aiSuggestionRepository";
import { db } from "../../shared/db";
import type { ActiveTimer, NoteAiSuggestion, Project, Task, TimeEntry } from "../../shared/domain";
import { importReamData, readAllExportData } from "../../shared/exportRepository";
import {
  buildDailySummaries,
  createReamExport,
  entriesToCsv,
  parseReamExport,
  serializeReamExport
} from "../../shared/reporting";
import { archiveProject, createProject, listActiveProjects, updateProject } from "../../shared/projectRepository";
import { createTask, listActiveTasks, updateTask } from "../../shared/taskRepository";
import { parseTags } from "../../shared/taskValidation";
import { formatDuration } from "../../shared/time";
import { activeTimerElapsedSeconds, createTimeEntry, deleteTimeEntry, getActiveTimer, startTimer, stopTimer, updateActiveTimerNote, updateTimeEntry } from "../../shared/timerRepository";
import { type AppSettings } from "../appSettings";
import { downloadTextFile, formatEntryDateTime, totalDuration } from "../rendererUtils";
import { themeOptions, type ThemeId } from "../themeOptions";
import reamIcon from "../assets/ream-icon.png";

type ActiveSection = "home" | "insights" | "timesheet" | "entries" | "tasks" | "notes" | "projects" | "backup" | "dev" | "profile";
type TimeViewMode = "day" | "week" | "month";

interface MainViewProps {
  appSettings: AppSettings;
  themeId: ThemeId;
  onAppSettingsChange: (settings: AppSettings) => void;
}

interface ReamDataLocationInfo {
  path: string;
  isCustom: boolean;
  defaultPath: string;
}

interface AiNotePreview {
  entryId: string;
  taskId: string;
  startedAt: string;
  endedAt: string;
  suggestionId: string;
  model: string;
  rawNote: string;
  output: ImprovedNoteOutput;
}

interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

interface InsightBucket {
  key: string;
  label: string;
  durations: number[];
  totalSeconds: number;
}

interface InsightSummaryRow {
  id: string;
  title: string;
  meta: string;
  durationSeconds: number;
  percent: number;
  icon: MainIconName;
  tone: number;
}

interface TimeInsights {
  range: DateRange;
  previousTotalSeconds: number;
  totalSeconds: number;
  dailyAverageSeconds: number;
  focusRatio: number;
  buckets: InsightBucket[];
  taskRows: InsightSummaryRow[];
  projectRows: InsightSummaryRow[];
  sessionRows: Array<{
    id: string;
    date: string;
    task: string;
    taskIcon: MainIconName;
    taskTone: number;
    project: string;
    durationSeconds: number;
    note: string;
  }>;
  heatmap: Array<{ label: string; periods: number[] }>;
  bestDay: { label: string; durationSeconds: number } | null;
  longestEntry: TimeEntry | null;
  topTask: InsightSummaryRow | null;
}

interface TimesheetDay {
  date: Date;
  label: string;
  shortDate: string;
}

interface TimesheetCell {
  durationSeconds: number;
  entryCount: number;
}

interface TimesheetRow {
  taskId: string;
  title: string;
  icon: MainIconName;
  tone: number;
  projects: string[];
  tags: string[];
  cells: TimesheetCell[];
  totalSeconds: number;
}

interface WeeklyTimesheet {
  range: DateRange;
  days: TimesheetDay[];
  rows: TimesheetRow[];
  dayTotals: number[];
  totalSeconds: number;
  notesCount: number;
}

interface TaskVisualIdentity {
  icon: MainIconName;
  tone: number;
}

export function MainView({ appSettings, themeId, onAppSettingsChange }: MainViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [allEntries, setAllEntries] = useState<TimeEntry[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<NoteAiSuggestion[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [, setSelectedTaskId] = useState("");
  const [timerNote, setTimerNote] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [title, setTitle] = useState("");
  const [taskProjectIds, setTaskProjectIds] = useState<string[]>([]);
  const [tags, setTags] = useState("");
  const [defaultNote, setDefaultNote] = useState("");
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [isEntryComposerOpen, setIsEntryComposerOpen] = useState(false);
  const [entryTaskId, setEntryTaskId] = useState("");
  const [entryStartedAt, setEntryStartedAt] = useState("");
  const [entryEndedAt, setEntryEndedAt] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<ActiveSection>("home");
  const [isTaskComposerOpen, setIsTaskComposerOpen] = useState(false);
  const [isProjectComposerOpen, setIsProjectComposerOpen] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [quickCapture, setQuickCapture] = useState("");
  const [ollamaModel, setOllamaModel] = useState(() => readStoredOllamaModel());
  const [aiLoadingNoteId, setAiLoadingNoteId] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<AiNotePreview | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [dataLocation, setDataLocation] = useState<ReamDataLocationInfo | null>(null);
  const [dataLocationBusy, setDataLocationBusy] = useState(false);
  const [settingsAiStatus, setSettingsAiStatus] = useState<string | null>(null);
  const [settingsAiBusy, setSettingsAiBusy] = useState(false);
  const [timeViewMode, setTimeViewMode] = useState<TimeViewMode>("week");

  const taskById = useMemo(() => new Map(allTasks.map((task) => [task.id, task])), [allTasks]);
  const projectById = useMemo(() => new Map(allProjects.map((project) => [project.id, project])), [allProjects]);
  const aiSuggestionByNoteId = useMemo(() => {
    const map = new Map<string, NoteAiSuggestion>();
    for (const suggestion of aiSuggestions) {
      if (!map.has(suggestion.noteId)) {
        map.set(suggestion.noteId, suggestion);
      }
    }
    return map;
  }, [aiSuggestions]);
  const archivedTasks = useMemo(() => allTasks.filter((task) => task.archived), [allTasks]);
  const archivedProjects = useMemo(() => allProjects.filter((project) => project.archived), [allProjects]);
  const activeTask = activeTimer ? taskById.get(activeTimer.taskId) : null;
  const dailySummaries = useMemo(() => buildDailySummaries(allEntries), [allEntries]);
  const timeInsights = useMemo(() => buildTimeInsights(allEntries, allTasks, allProjects, timeViewMode), [allEntries, allProjects, allTasks, timeViewMode]);
  const weeklyTimesheet = useMemo(() => buildWeeklyTimesheet(allEntries, allTasks, allProjects), [allEntries, allProjects, allTasks]);
  const recentEntries = useMemo(
    () => [...allEntries].sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    [allEntries]
  );
  const noteEntries = useMemo(() => recentEntries.filter((entry) => entry.note.trim()), [recentEntries]);
  const improvedAiSuggestions = useMemo(() => aiSuggestions.filter((suggestion) => suggestion.status !== "pending"), [aiSuggestions]);
  const aiSuggestionStats = useMemo(() => {
    const recordedDurations = aiSuggestions
      .map((suggestion) => normalizeSuggestionDuration(suggestion))
      .filter((durationMs): durationMs is number => durationMs >= 0);
    const totalDurationMs = recordedDurations.reduce((total, durationMs) => total + durationMs, 0);
    return {
      total: aiSuggestions.length,
      pending: aiSuggestions.filter((suggestion) => suggestion.status === "pending").length,
      accepted: aiSuggestions.filter((suggestion) => suggestion.status === "accepted").length,
      rejected: aiSuggestions.filter((suggestion) => suggestion.status === "rejected").length,
      copied: aiSuggestions.filter((suggestion) => suggestion.status === "copied").length,
      averageDurationMs: recordedDurations.length ? totalDurationMs / recordedDurations.length : -1
    };
  }, [aiSuggestions]);
  const today = useMemo(() => new Date().toDateString(), []);
  const taskActivity = useMemo(() => {
    const activity = new Map<string, { durationSeconds: number; entryCount: number; noteCount: number }>();
    for (const entry of allEntries) {
      const current = activity.get(entry.taskId) ?? { durationSeconds: 0, entryCount: 0, noteCount: 0 };
      if (new Date(entry.startedAt).toDateString() === today) {
        current.durationSeconds += entry.durationSeconds;
      }
      current.entryCount += 1;
      current.noteCount += entry.note.trim() ? 1 : 0;
      activity.set(entry.taskId, current);
    }
    return activity;
  }, [allEntries, today]);

  const refreshAppState = useCallback(async () => {
    const [nextTasks, nextProjects, nextActiveTimer, exportData, nextAiSuggestions] = await Promise.all([
      listActiveTasks(db),
      listActiveProjects(db),
      getActiveTimer(db),
      readAllExportData(db),
      listNoteAiSuggestions(db)
    ]);

    setTasks(nextTasks);
    setProjects(nextProjects);
    setAllProjects(exportData.projects);
    setAllTasks(exportData.tasks);
    setAllEntries(exportData.timeEntries);
    setAiSuggestions(nextAiSuggestions);
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

  useEffect(() => {
    window.localStorage.setItem(OLLAMA_MODEL_STORAGE_KEY, ollamaModel.trim() || DEFAULT_OLLAMA_MODEL);
  }, [ollamaModel]);

  useEffect(() => {
    window.reamDesktop?.getDataLocation?.()
      .then(setDataLocation)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    return window.reamDesktop?.onOpenSettingsRequested?.(() => setActiveSection("profile"));
  }, []);

  function updateAppSettings(patch: Partial<AppSettings>) {
    onAppSettingsChange({ ...appSettings, ...patch });
  }

  async function handleChooseDataLocation() {
    setError(null);
    setDataLocationBusy(true);
    try {
      const nextLocation = await window.reamDesktop?.chooseDataLocation?.();
      if (nextLocation) {
        setDataLocation(nextLocation);
      }
    } catch (locationError) {
      setError(locationError instanceof Error ? locationError.message : "Unable to change data folder.");
    } finally {
      setDataLocationBusy(false);
    }
  }

  async function handleCheckOllamaStatus() {
    setSettingsAiBusy(true);
    setSettingsAiStatus(null);
    try {
      const status = await window.reamDesktop?.getOllamaStatus?.();
      if (!status) {
        throw new Error("Ollama status is only available in the desktop app.");
      }
      setSettingsAiStatus(
        status.ollama.ok
          ? `Ollama is running.\nActive model: ${status.model}\nFallback model: ${status.fallbackModel}`
          : "Ollama is not running yet."
      );
    } catch (statusError) {
      setSettingsAiStatus(statusError instanceof Error ? statusError.message : "Unable to check Ollama.");
    } finally {
      setSettingsAiBusy(false);
    }
  }

  async function handleOpenOllamaDownload() {
    try {
      const openDownload = window.reamDesktop?.openOllamaDownload;
      if (!openDownload) {
        throw new Error("Ollama download is only available in the desktop app.");
      }
      const shouldOpen = window.confirm("Open the Ollama download page in your browser?");
      if (!shouldOpen) {
        setSettingsAiStatus("Stayed in Ream. No browser opened.");
        return;
      }
      await openDownload();
      setSettingsAiStatus("Opened the Ollama download page in your browser.");
    } catch (downloadError) {
      setSettingsAiStatus(downloadError instanceof Error ? downloadError.message : "Unable to open Ollama download.");
    }
  }

  async function handlePullOllamaModel() {
    try {
      const model = ollamaModel.trim() || DEFAULT_OLLAMA_MODEL;
      const openLibrary = window.reamDesktop?.openOllamaLibrary;
      if (!openLibrary) {
        throw new Error("Ollama library is only available in the desktop app.");
      }
      const shouldOpen = window.confirm(`Open the Ollama library in your browser for ${model}?`);
      if (!shouldOpen) {
        setSettingsAiStatus("Stayed in Ream. No browser opened.");
        return;
      }
      await openLibrary(model);
      setSettingsAiStatus(`Opened the Ollama library in your browser for ${model}.`);
    } catch (pullError) {
      setSettingsAiStatus(pullError instanceof Error ? pullError.message : "Unable to open the Ollama library.");
    }
  }

  function applyLocalAiSuggestionUpdate(updatedSuggestion: NoteAiSuggestion) {
    setAiSuggestions((current) => current.map((suggestion) => suggestion.id === updatedSuggestion.id ? updatedSuggestion : suggestion));
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const task = await createTask(db, {
        title,
        projectIds: taskProjectIds,
        tags: parseTags(tags),
        defaultNote
      });
      setTitle("");
      setTaskProjectIds([]);
      setTags("");
      setDefaultNote("");
      await refreshAppState();
      setSelectedTaskId(task.id);
      setIsTaskComposerOpen(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create task.");
    }
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await createProject(db, { title: newProjectTitle });
      setNewProjectTitle("");
      setIsProjectComposerOpen(false);
      await refreshAppState();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create project.");
    }
  }

  async function handleArchiveProject(projectId: string) {
    setError(null);
    try {
      await archiveProject(db, projectId);
      await refreshAppState();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to archive project.");
    }
  }

  async function handleUnarchiveProject(projectId: string) {
    setError(null);
    try {
      await updateProject(db, projectId, { archived: false });
      await refreshAppState();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to restore project.");
    }
  }

  async function handleRenameProject(project: Project) {
    const title = window.prompt("Project name", project.title);
    if (title === null || title.trim() === project.title) {
      return;
    }
    setError(null);
    try {
      await updateProject(db, project.id, { title });
      await refreshAppState();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to rename project.");
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

  async function handleUnarchiveTask(task: Task) {
    setError(null);

    try {
      await updateTask(db, task.id, { archived: false });
      await refreshAppState();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to restore task.");
    }
  }

  async function handleStartTask(taskId: string) {
    setSelectedTaskId(taskId);
    setError(null);

    try {
      const nextActiveTimer = await startTimer(db, { taskId, note: "" });
      setActiveTimer(nextActiveTimer);
      setElapsed(0);
      await window.reamDesktop?.showOverlayWindow?.({ hideMain: false });
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Unable to start timer.");
    }
  }

  function handleQuickCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const capturedTitle = quickCapture.trim();
    if (!capturedTitle) {
      setIsTaskComposerOpen(true);
      return;
    }
    setTitle(capturedTitle);
    setQuickCapture("");
    setIsTaskComposerOpen(true);
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
    setIsEntryComposerOpen(true);
    setEditingEntry(entry);
    setEntryTaskId(entry.taskId);
    setEntryStartedAt(toDateTimeLocalValue(entry.startedAt));
    setEntryEndedAt(toDateTimeLocalValue(entry.endedAt));
    setEntryNote(entry.note);
  }

  function handleNewEntry() {
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - 30 * 60_000);
    setError(null);
    setEditingEntry(null);
    setEntryTaskId(tasks[0]?.id ?? "");
    setEntryStartedAt(toDateTimeLocalValue(startedAt.toISOString()));
    setEntryEndedAt(toDateTimeLocalValue(endedAt.toISOString()));
    setEntryNote("");
    setIsEntryComposerOpen(true);
  }

  function handleCloseEntryEditor() {
    setIsEntryComposerOpen(false);
    setEditingEntry(null);
    setEntryTaskId("");
    setEntryStartedAt("");
    setEntryEndedAt("");
    setEntryNote("");
  }

  async function handleSaveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entryTaskId) {
      setError("Choose a task for this entry.");
      return;
    }

    setError(null);
    try {
      const input = {
        taskId: entryTaskId,
        startedAt: entryStartedAt,
        endedAt: entryEndedAt,
        note: entryNote
      };
      if (editingEntry) {
        await updateTimeEntry(db, editingEntry.id, input);
      } else {
        await createTimeEntry(db, input);
      }
      handleCloseEntryEditor();
      await refreshAppState();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save time entry.");
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

  async function handleImproveNote(entry: TimeEntry) {
    const task = taskById.get(entry.taskId);
    if (!task) {
      setAiError("Task context is missing for this note.");
      return;
    }

    const noteText = entry.note.trim();
    if (!noteText) {
      setAiError("Choose a saved note before using AI.");
      return;
    }

    setAiError(null);
    setAiLoadingNoteId(entry.id);

    try {
      if (!window.reamDesktop?.improveNoteWithAi) {
        throw new Error("AI is only available in the desktop app.");
      }

      const projectName = task.projectIds.map((id) => projectById.get(id)?.title).filter(Boolean).join(", ");
      const requestStartedAt = readClockMs();
      const result = await window.reamDesktop.improveNoteWithAi({
        noteText,
        taskTitle: task.title,
        projectName,
        tags: task.tags,
        model: ollamaModel.trim() || DEFAULT_OLLAMA_MODEL
      });
      const durationMs = readClockMs() - requestStartedAt;
      const savedSuggestion = await createNoteAiSuggestion(db, {
        noteId: entry.id,
        model: result.model,
        inputText: noteText,
        outputJson: result.output,
        durationMs
      });

      setAiPreview({
        entryId: entry.id,
        taskId: entry.taskId,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        suggestionId: savedSuggestion.id,
        model: result.model,
        rawNote: noteText,
        output: result.output
      });
    } catch (improveError) {
      setAiError(improveError instanceof Error ? improveError.message : "Unable to improve note with AI.");
    } finally {
      setAiLoadingNoteId(null);
    }
  }

  async function handleAcceptAiSuggestion(preview: AiNotePreview) {
    if (!window.confirm("Replace this note with the AI suggestion? The original raw note will remain stored with the AI record.")) {
      return;
    }

    setAiError(null);
    try {
      await updateTimeEntry(db, preview.entryId, {
        taskId: preview.taskId,
        startedAt: preview.startedAt,
        endedAt: preview.endedAt,
        note: preview.output.clean_note
      });
      await updateNoteAiSuggestionStatus(db, preview.suggestionId, "accepted");
      setAiPreview(null);
      await refreshAppState();
    } catch (acceptError) {
      setAiError(acceptError instanceof Error ? acceptError.message : "Unable to accept AI suggestion.");
    }
  }

  async function handleRejectAiSuggestion(preview: AiNotePreview) {
    setAiError(null);
    try {
      const updatedSuggestion = await updateNoteAiSuggestionStatus(db, preview.suggestionId, "rejected");
      applyLocalAiSuggestionUpdate(updatedSuggestion);
      setAiPreview(null);
    } catch (rejectError) {
      setAiError(rejectError instanceof Error ? rejectError.message : "Unable to reject AI suggestion.");
    }
  }

  async function handleCopyAiSuggestion(preview: AiNotePreview) {
    setAiError(null);
    try {
      await navigator.clipboard.writeText(preview.output.clean_note);
    } catch (copyError) {
      setAiError(copyError instanceof Error ? copyError.message : "Unable to copy AI suggestion.");
      return;
    }
    try {
      const updatedSuggestion = await updateNoteAiSuggestionStatus(db, preview.suggestionId, "copied");
      applyLocalAiSuggestionUpdate(updatedSuggestion);
    } catch (statusError) {
      console.error("Failed to record AI suggestion copy status", statusError);
    }
  }

  function renderImproveNoteButton(entry: TimeEntry): ReactNode {
    if (!entry.note.trim()) {
      return null;
    }

    const noteText = entry.note.trim();
    const aiSuggestion = aiSuggestionByNoteId.get(entry.id);
    if (aiSuggestion && (aiSuggestion.status === "accepted" || aiSuggestion.inputText === noteText)) {
      return <button className="ai-note-button is-muted" onClick={() => void handleOpenSavedAiSuggestion(entry, aiSuggestion)}>{getAiSuggestionButtonLabel(aiSuggestion)}</button>;
    }

    return <button className="ai-note-button" disabled={aiLoadingNoteId === entry.id} onClick={() => void handleImproveNote(entry)}>{aiLoadingNoteId === entry.id ? "Improving..." : "Improve with AI"}</button>;
  }

  function renderAiPreview(entry: TimeEntry): ReactNode {
    const preview = aiPreview?.entryId === entry.id ? aiPreview : null;
    if (!preview) {
      return null;
    }

    return <div className="ai-note-preview"><section className="ai-note-preview-panel"><h3>Raw note</h3><div className="ai-note-preview-body"><p>{preview.rawNote}</p></div></section><section className="ai-note-preview-panel is-suggestion"><h3>AI suggestion</h3><div className="ai-note-preview-body"><p>{preview.output.clean_note}</p><dl><div><dt>Summary</dt><dd>{preview.output.summary}</dd></div><div><dt>Next steps</dt><dd>{preview.output.next_steps.length ? preview.output.next_steps.join("; ") : "None"}</dd></div><div><dt>Blockers</dt><dd>{preview.output.blockers.length ? preview.output.blockers.join("; ") : "None"}</dd></div><div><dt>Tags</dt><dd>{preview.output.tags.length ? preview.output.tags.join(", ") : "None"}</dd></div></dl><small>Model: {preview.model}</small></div><div className="ai-note-actions"><button onClick={() => void handleAcceptAiSuggestion(preview)}>Accept</button><button onClick={() => void handleCopyAiSuggestion(preview)}>Copy suggestion</button><button onClick={() => void handleRejectAiSuggestion(preview)}>Reject</button></div></section></div>;
  }

  async function handleOpenSavedAiSuggestion(entry: TimeEntry, suggestion: NoteAiSuggestion) {
    setAiError(null);
    const isSamePreview = aiPreview?.entryId === entry.id && aiPreview?.suggestionId === suggestion.id;
    if (isSamePreview) {
      setAiPreview(null);
      return;
    }

    setAiPreview({
      entryId: entry.id,
      taskId: entry.taskId,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      suggestionId: suggestion.id,
      model: suggestion.model,
      rawNote: suggestion.inputText,
      output: validateImprovedNoteOutput(suggestion.outputJson)
    });
  }

  async function handleExportJson() {
    setError(null);

    try {
      const exportData = await readAllExportData(db);
      downloadTextFile(
        `ream-export-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json",
        serializeReamExport(createReamExport(exportData.tasks, exportData.projects, exportData.timeEntries))
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
        `ream-export-${new Date().toISOString().slice(0, 10)}.csv`,
        "text/csv",
        entriesToCsv(exportData.timeEntries, exportData.tasks, exportData.projects)
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
      const exportData = parseReamExport(text);
      const shouldRestore = window.confirm(
        `Import ${exportData.tasks.length} tasks and ${exportData.timeEntries.length} time entries? This replaces local data.`
      );
      if (!shouldRestore) {
        return;
      }
      await importReamData(db, exportData);
      await refreshAppState();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Unable to import JSON.");
    }
  }

  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  const navigationGroups: Array<{ label: string; items: Array<{ id: Exclude<ActiveSection, "profile">; label: string; icon: MainIconName }> }> = [
    {
      label: "Workspace",
      items: [
        { id: "home", label: "Home", icon: "home" },
        { id: "entries", label: "Entries", icon: "clock" },
        { id: "tasks", label: "Tasks", icon: "list" },
        { id: "notes", label: "Notes", icon: "note" },
        { id: "projects", label: "Projects", icon: "briefcase" }
      ]
    },
    {
      label: "Utilities",
      items: [
        { id: "insights", label: "Insights", icon: "chart" },
        { id: "timesheet", label: "Timesheet", icon: "calendar" },
        { id: "backup", label: "Settings", icon: "settings" },
        { id: "dev", label: "AI Stats", icon: "chart" }
      ]
    }
  ];
  const navigation = navigationGroups.flatMap((group) => group.items);

  const headerAction = (() => {
    if (activeSection === "home" || activeSection === "tasks") {
      return <button className="new-project-button" onClick={() => setIsTaskComposerOpen(true)}><MainIcon name="plus" />New Task</button>;
    }
    if (activeSection === "entries") {
      return <button className="new-project-button" disabled={tasks.length === 0} onClick={handleNewEntry}><MainIcon name="plus" />New Entry</button>;
    }
    if (activeSection === "projects") {
      return <button className="new-project-button" onClick={() => setIsProjectComposerOpen(true)}><MainIcon name="plus" />New Project</button>;
    }
    if (activeSection === "insights") {
      return <div className="time-header-actions"><button className="time-range-button" type="button"><MainIcon name="calendar" />{timeInsights.range.label}<MainIcon name="chevron" /></button><button className="time-filter-button" type="button"><MainIcon name="filter" />Filters<MainIcon name="chevron" /></button></div>;
    }
    if (activeSection === "timesheet") {
      return <div className="time-header-actions"><button className="time-range-button" type="button"><MainIcon name="calendar" />{weeklyTimesheet.range.label}<MainIcon name="chevron" /></button><button className="time-filter-button" type="button"><MainIcon name="filter" />Filters<MainIcon name="chevron" /></button><button aria-label="Timesheet actions" className="time-icon-button" type="button"><MainIcon name="more" /></button></div>;
    }
    return null;
  })();

  const displayName = appSettings.userName.trim() || "there";
  const profileInitials = getInitials(displayName);
  const activeTheme = themeOptions.find((theme) => theme.id === themeId) ?? themeOptions[0];
  const sectionTitle = activeSection === "profile"
    ? "Profile"
    : activeSection === "insights"
      ? "Time View"
      : activeSection === "timesheet"
        ? "Weekly Timesheet"
        : navigation.find((item) => item.id === activeSection)?.label;
  const sectionSubtitle = activeSection === "home"
    ? "Stay focused. Make steady progress."
    : activeSection === "insights"
      ? "See where you have spent your time across days, weeks, and months."
      : activeSection === "timesheet"
        ? "Track your time across tasks for the week."
        : activeSection === "profile"
          ? "Tune how Ream feels on this device."
          : "Everything stays local to this device.";

  return (
    <main className={`dashboard-shell theme-${themeId}`}>
      <aside className="dashboard-sidebar">
        <div className="brand-lockup"><span className="brand-mark"><img alt="Ream" src={reamIcon} /></span><div><strong>Ream</strong><p>Time on what matters.</p></div><button aria-label="Show overlay" className="brand-overlay-button" onClick={() => window.reamDesktop?.showOverlayWindow?.()} type="button"><MainIcon name="overlay" /><span>Show overlay</span></button></div>
        <nav className="dashboard-nav" aria-label="Main navigation">
          {navigationGroups.map((group) => <details className="nav-group" key={group.label} open>
            <summary><span>{group.label}</span><MainIcon name="chevron" /></summary>
            <div className="nav-group-items">
              {group.items.map((item) => <button className={activeSection === item.id ? "is-active" : ""} key={item.id} onClick={() => setActiveSection(item.id)}><MainIcon name={item.icon} />{item.label}</button>)}
            </div>
          </details>)}
        </nav>
        <div className="sidebar-bottom">
          <button aria-label="Open profile settings" className={`profile-row ${activeSection === "profile" ? "is-active" : ""}`} onClick={() => setActiveSection("profile")} type="button"><span>{profileInitials}</span><p>{displayName}</p><MainIcon name="chevron" /></button>
        </div>
      </aside>

      <section className={`dashboard-page ${activeSection === "profile" ? "is-profile-section" : ""}`}>
        <header className="dashboard-header">
          <div><h1>{activeSection === "home" ? `${greeting}, ${displayName}.` : sectionTitle}</h1><p>{sectionSubtitle}</p></div>
          {headerAction}
        </header>

        {error ? <p className="dashboard-error" role="alert">{error}</p> : null}

        {activeSection === "home" ? <>
          <form className="quick-capture" onSubmit={handleQuickCapture}><span><MainIcon name="pen" /></span><input value={quickCapture} onChange={(event) => setQuickCapture(event.target.value)} placeholder="Capture a task or note..." /><button aria-label="Create task" type="submit"><MainIcon name="plus" /></button></form>
          {activeTimer ? <section className="active-timer-banner"><div><span className="timer-pulse" />Tracking <strong>{activeTask?.title ?? "Task"}</strong><small>{formatDuration(elapsed)}</small></div><input value={timerNote} onBlur={handleSaveTimerNote} onChange={(event) => setTimerNote(event.target.value)} placeholder="Add a timer note..." /><button onClick={handleStopTimer}>Stop timer</button></section> : null}
          <section className="projects-section"><div className="section-title"><h2>Your Tasks</h2><span>{tasks.length} active</span></div><div className="project-cards" aria-live="polite">
            {loading ? <p className="empty-state">Loading your tasks...</p> : null}
            {!loading && tasks.length === 0 ? <p className="empty-state">Create your first task to start tracking time.</p> : null}
            {tasks.map((task) => { const activity = taskActivity.get(task.id) ?? { durationSeconds: 0, entryCount: 0, noteCount: 0 }; return <article className="project-card" key={task.id}>
              <TaskIdentityIcon className="project-icon task-identity-icon" task={task} /><div className="project-copy"><h3>{task.title}</h3><p>{formatDuration(activity.durationSeconds)} today <i>•</i> {activity.noteCount} {activity.noteCount === 1 ? "note" : "notes"}</p><small>{task.projectIds.length ? task.projectIds.map((id) => projectById.get(id)?.title).filter(Boolean).join(" · ") : task.defaultNote ? `Latest note: ${task.defaultNote}` : activity.entryCount ? `${activity.entryCount} tracked entries` : "No project assigned"}</small></div>
              {activeTimer?.taskId === task.id ? <button className="card-timer-button is-running" onClick={handleStopTimer}>Stop</button> : <button aria-label={`Start ${task.title}`} className="card-timer-button" disabled={Boolean(activeTimer)} onClick={() => handleStartTask(task.id)}><MainIcon name="play" /></button>}
              <button className="archive-task-button" disabled={activeTimer?.taskId === task.id} onClick={() => handleArchiveTask(task)}>Archive</button>
            </article>; })}
          </div></section>
          <footer className="dashboard-footer"><MainIcon name="note" />Notes live with your tasks.</footer>
        </> : null}

        {activeSection === "insights" ? <section className="time-view-section">
          <div className="time-mode-tabs" role="tablist" aria-label="Time view range">
            {(["day", "week", "month"] as TimeViewMode[]).map((mode) => <button aria-pressed={timeViewMode === mode} className={timeViewMode === mode ? "is-active" : ""} key={mode} onClick={() => setTimeViewMode(mode)} type="button">{capitalize(mode)}</button>)}
          </div>

          <section className="time-reflection-panel">
            <div className="time-reflection-copy"><span><MainIcon name="sparkle" /></span><div><h2>{timeViewMode === "week" ? "Weekly reflection" : `${capitalize(timeViewMode)} reflection`}</h2><p>{buildReflectionCopy(timeInsights)}</p></div></div>
            <div className="time-metrics">
              <MetricPill icon="clock" label="Total time" value={formatCompactDuration(timeInsights.totalSeconds)} delta={formatPercentDelta(timeInsights.totalSeconds, timeInsights.previousTotalSeconds)} />
              <MetricPill icon="trend" label="Daily average" value={formatCompactDuration(timeInsights.dailyAverageSeconds)} delta={formatPercentDelta(timeInsights.dailyAverageSeconds, timeInsights.previousTotalSeconds / Math.max(1, timeInsights.buckets.length))} />
              <MetricPill icon="target" label="Focus ratio" value={`${timeInsights.focusRatio}%`} delta={timeInsights.focusRatio ? "tracked focus" : "no focus yet"} />
            </div>
          </section>

          <div className="time-insight-grid">
            <section className="time-card time-chart-card">
              <SectionNumber title="Time across tasks" number="1." />
              <div className="time-legend">{timeInsights.taskRows.slice(0, 6).map((row) => <span key={row.id}><i className={`time-tone-${row.tone}`} />{row.title}</span>)}</div>
              <div className="stacked-chart" aria-label="Time across tasks chart">
                {timeInsights.buckets.map((bucket) => <div className="stacked-column" key={bucket.key}><span>{bucket.totalSeconds ? formatCompactDuration(bucket.totalSeconds) : ""}</span><div>{renderStackedTaskSegments(bucket, timeInsights.taskRows)}</div><small>{bucket.label}</small></div>)}
              </div>
            </section>

            <section className="time-card time-list-card">
              <SectionNumber title={`Tasks this ${timeViewMode}`} number="2." />
              <InsightRanking rows={timeInsights.taskRows} totalSeconds={timeInsights.totalSeconds} />
            </section>

            <section className="time-card time-list-card">
              <SectionNumber title={`Projects this ${timeViewMode}`} number="3." />
              <InsightRanking rows={timeInsights.projectRows} totalSeconds={timeInsights.totalSeconds} />
            </section>

            <section className="time-card time-session-card">
              <div className="time-card-heading-row"><SectionNumber title="Session log" number="4." /><div className="time-session-tools"><label><MainIcon name="search" /><input placeholder="Search sessions..." readOnly /></label><button type="button"><MainIcon name="filter" />Filter</button><button aria-label="More session actions" type="button"><MainIcon name="more" /></button></div></div>
              <div className="time-session-table">
                <div className="time-session-head"><span>Date</span><span>Task</span><span>Project</span><span>Duration</span><span>Notes</span></div>
                {timeInsights.sessionRows.length === 0 ? <p className="empty-state">Tracked sessions will appear here.</p> : timeInsights.sessionRows.map((row) => <div className="time-session-row" key={row.id}><span>{row.date}</span><span><i className={`time-tone-bg-${row.taskTone}`}><MainIcon name={row.taskIcon} /></i>{row.task}</span><span>{row.project}</span><strong>{formatCompactDuration(row.durationSeconds)}</strong><p>{row.note || "No note"}</p></div>)}
              </div>
              <footer>{timeInsights.sessionRows.length} sessions</footer>
            </section>

            <section className="time-card time-highlights-card">
              <SectionNumber title="Highlights" number="5." />
              <div className="time-highlights">
                <HighlightItem icon="sparkle" label="Best day" value={timeInsights.bestDay?.label ?? "No time yet"} detail={timeInsights.bestDay ? `${formatCompactDuration(timeInsights.bestDay.durationSeconds)} total time` : "Start tracking to build history"} />
                <HighlightItem icon="clock" label="Longest focus block" value={timeInsights.longestEntry ? formatCompactDuration(timeInsights.longestEntry.durationSeconds) : "No block yet"} detail={timeInsights.longestEntry ? `${formatShortDate(timeInsights.longestEntry.startedAt)} · ${taskById.get(timeInsights.longestEntry.taskId)?.title ?? "Archived task"}` : "Completed entries will appear here"} />
                <HighlightItem icon="trophy" label="Top task" value={timeInsights.topTask?.title ?? "No task yet"} detail={timeInsights.topTask ? `${formatCompactDuration(timeInsights.topTask.durationSeconds)} · ${timeInsights.topTask.percent}% of total time` : "Track a task to see the leader"} />
              </div>
            </section>

            <section className="time-card time-heatmap-card">
              <div className="time-card-heading-row"><SectionNumber title="Time heatmap" number="6." /><div className="heatmap-scale"><span>Less</span><i /><i /><i /><i /><i /><span>More</span></div></div>
              <div className="heatmap-grid" style={cssVars({ "--heatmap-columns": String(timeInsights.buckets.length || 1) })}>
                <span />
                {timeInsights.buckets.map((bucket) => <strong key={bucket.key}>{bucket.label}</strong>)}
                {timeInsights.heatmap.map((row) => <div className="heatmap-row" key={row.label} style={cssVars({ "--heatmap-columns": String(timeInsights.buckets.length || 1) })}><b>{row.label}</b>{row.periods.map((durationSeconds, index) => <i key={`${row.label}-${index}`} style={cssVars({ "--heat": String(normalizeHeat(durationSeconds, timeInsights.heatmap)) })} />)}</div>)}
              </div>
            </section>
          </div>
        </section> : null}

        {activeSection === "timesheet" ? <section className="timesheet-section">
          <div className="timesheet-frame">
            <div className="timesheet-grid" style={cssVars({ "--timesheet-day-count": String(weeklyTimesheet.days.length) })}>
              <div className="timesheet-task-header"><strong>Task</strong><span>and projects</span></div>
              {weeklyTimesheet.days.map((day) => <div className="timesheet-day-header" key={day.shortDate}><strong>{day.label}</strong><span>{day.shortDate}</span></div>)}
              <div className="timesheet-total-header">Task total</div>

              {weeklyTimesheet.rows.length === 0 ? <div className="timesheet-empty">Track time on a task this week to build your timesheet.</div> : weeklyTimesheet.rows.map((row) => {
                const chips = [...row.projects, ...row.tags].slice(0, 4);
                return <Fragment key={row.taskId}>
                  <div className="timesheet-task-cell" key={`${row.taskId}-task`}><TaskIdentityIcon className="timesheet-task-icon" identity={{ icon: row.icon, tone: row.tone }} title={row.title} /><div><strong>{row.title}</strong>{chips.length ? <span className="timesheet-chip-row">{chips.map((tag) => <i key={tag}>{tag}</i>)}</span> : null}</div></div>
                  {row.cells.map((cell, index) => <div className={cell.durationSeconds ? "timesheet-time-cell" : "timesheet-time-cell is-empty"} key={`${row.taskId}-${weeklyTimesheet.days[index].shortDate}`}><strong>{formatTimesheetDuration(cell.durationSeconds)}</strong>{cell.entryCount ? <small><MainIcon name="clock" />{cell.entryCount}</small> : null}</div>)}
                  <div className="timesheet-total-cell" key={`${row.taskId}-total`}>{formatTimesheetDuration(row.totalSeconds)}</div>
                </Fragment>;
              })}

              <div className="timesheet-task-cell timesheet-footer-label"><span>Total hours / day <MainIcon name="info" /></span></div>
              {weeklyTimesheet.dayTotals.map((totalSeconds, index) => <div className="timesheet-time-cell timesheet-footer-total" key={`day-total-${weeklyTimesheet.days[index].shortDate}`}>{formatTimesheetDuration(totalSeconds)}</div>)}
              <div className="timesheet-total-cell timesheet-footer-grand">{formatTimesheetDuration(weeklyTimesheet.totalSeconds)}</div>
            </div>
          </div>
          <footer className="timesheet-notes"><MainIcon name="note" />Notes ({weeklyTimesheet.notesCount}) across this week</footer>
        </section> : null}

        {activeSection === "entries" ? <section className="dashboard-panel"><div className="section-title"><h2>Recent entries</h2><span>{recentEntries.length} entries</span></div>{aiError ? <p className="ai-note-error" role="alert">{aiError}</p> : null}<div className="dashboard-entry-list">
          {recentEntries.length === 0 ? <p className="empty-state">No completed time entries yet.</p> : recentEntries.map((entry) => {
            const aiSuggestion = aiSuggestionByNoteId.get(entry.id);
            return <article className={aiPreview?.entryId === entry.id ? "has-ai-preview" : ""} key={entry.id}><div><strong>{taskById.get(entry.taskId)?.title ?? "Archived task"}</strong><p>{formatEntryDateTime(entry.startedAt)} — {formatEntryDateTime(entry.endedAt)}</p>{entry.note ? <small className="entry-note-text">{entry.note}</small> : null}{aiSuggestion ? <small className="ai-note-status">{getAiSuggestionSummary(aiSuggestion)}</small> : null}{renderAiPreview(entry)}</div><span>{formatDuration(entry.durationSeconds)}</span>{renderImproveNoteButton(entry)}<button onClick={() => handleEditEntry(entry)}>Edit</button><button className="delete-entry" onClick={() => handleDeleteEntry(entry)}>Delete</button></article>;
          })}
        </div></section> : null}

        {activeSection === "tasks" ? <section className="dashboard-panel"><div className="section-title"><h2>All tasks</h2><span>{tasks.length} active</span></div><div className="project-management-list">
          {tasks.length === 0 ? <p className="empty-state">No active tasks.</p> : null}
          {tasks.map((task) => <article key={task.id}><TaskIdentityIcon className="task-list-icon" task={task} /><div><strong>{task.title}</strong><p>{task.projectIds.length ? task.projectIds.map((id) => projectById.get(id)?.title).filter(Boolean).join(" · ") : "No project"}{task.tags.length ? ` · ${task.tags.join(", ")}` : ""}</p></div><span>{formatDuration(taskActivity.get(task.id)?.durationSeconds ?? 0)} today</span><button disabled={activeTimer?.taskId === task.id} onClick={() => handleArchiveTask(task)}>Archive</button></article>)}
          {archivedTasks.length ? <div className="archived-list-heading">Archived tasks</div> : null}
          {archivedTasks.map((task) => <article className="is-archived" key={task.id}><TaskIdentityIcon className="task-list-icon" task={task} /><div><strong>{task.title}</strong><p>{task.projectIds.length ? task.projectIds.map((id) => projectById.get(id)?.title).filter(Boolean).join(" · ") : "No project"}{task.tags.length ? ` · ${task.tags.join(", ")}` : ""}</p></div><span>{formatDuration(taskActivity.get(task.id)?.durationSeconds ?? 0)} total</span><button onClick={() => handleUnarchiveTask(task)}>Unarchive</button></article>)}
        </div></section> : null}

        {activeSection === "projects" ? <section className="dashboard-panel"><div className="section-title"><h2>Projects</h2><span>{projects.length + archivedProjects.length} total</span></div><div className="project-management-list">
          {projects.length === 0 && archivedProjects.length === 0 ? <p className="empty-state">Create projects to organize related tasks.</p> : projects.map((project) => <article key={project.id}><div><strong>{project.title}</strong><p>{tasks.filter((task) => task.projectIds.includes(project.id)).length} active tasks</p></div><button onClick={() => handleRenameProject(project)}>Rename</button><button onClick={() => handleArchiveProject(project.id)}>Archive</button></article>)}
          {archivedProjects.length ? <div className="archived-list-heading">Archived projects</div> : null}
          {archivedProjects.map((project) => <article className="is-archived" key={project.id}><div><strong>{project.title}</strong><p>Archived project</p></div><button onClick={() => handleRenameProject(project)}>Rename</button><button onClick={() => handleUnarchiveProject(project.id)}>Unarchive</button></article>)}
        </div></section> : null}

        {activeSection === "notes" ? <section className="dashboard-panel"><div className="section-title"><h2>Task notes</h2><span>{noteEntries.length} saved</span></div>{aiError ? <p className="ai-note-error" role="alert">{aiError}</p> : null}<div className="notes-list">
          {noteEntries.length === 0 ? <p className="empty-state">Notes added while tracking will appear here.</p> : noteEntries.map((entry) => {
            const improveButton = renderImproveNoteButton(entry);
            return <article className={aiPreview?.entryId === entry.id ? "has-ai-preview" : ""} key={entry.id}><span><MainIcon name="note" /></span><div className="note-row-body"><div className="note-row-header"><div><strong>{taskById.get(entry.taskId)?.title ?? "Archived task"}</strong><p>{entry.note}</p><small>{formatEntryDateTime(entry.startedAt)}</small></div><button className="note-edit-button" onClick={() => handleEditEntry(entry)} type="button"><MainIcon name="pen" />Edit</button></div>{renderAiPreview(entry)}{improveButton ? <div className="ai-note-footer">{improveButton}</div> : null}</div></article>;
          })}
        </div></section> : null}

        {activeSection === "backup" ? <div className="settings-grid settings-system-grid">
          <section className="dashboard-panel data-location-panel">
            <PanelKicker icon="briefcase" label="Data" />
            <h2>Storage folder</h2>
            <div className="data-location-current">
              <span>{dataLocation?.isCustom ? "Custom" : "Default"}</span>
              <code>{dataLocation?.path ?? "Loading..."}</code>
            </div>
            <button className="settings-action-button" disabled={dataLocationBusy || !window.reamDesktop?.chooseDataLocation} onClick={() => void handleChooseDataLocation()} type="button"><MainIcon name="briefcase" />Change folder</button>
          </section>

          <section className="dashboard-panel backup-panel">
            <PanelKicker icon="shield" label="Backup" />
            <h2>Keep a private copy</h2>
            <p>Export JSON for a full restore, or CSV for a report. Importing JSON replaces the data stored on this device.</p>
            <div className="backup-actions"><button className="new-project-button" onClick={handleExportJson}><MainIcon name="plus" />Export JSON</button><button onClick={handleExportCsv}><MainIcon name="list" />Export CSV</button><label><MainIcon name="timer" />Import JSON<input accept="application/json,.json" type="file" onChange={handleImportJson} /></label></div>
          </section>

          <section className="dashboard-panel ai-settings-panel">
            <div className="settings-panel-heading">
              <PanelKicker icon="settings" label="Local AI" />
              <label className="settings-toggle">Enable AI note improvement<input checked={appSettings.aiSetupPreference === "enabled" } onChange={(event) => updateAppSettings({ aiSetupPreference: event.target.checked ? "enabled" : "skipped" })} type="checkbox" /><span /></label>
            </div>
            <h2>Ollama sidecar</h2>
            <p>Improve notes with a local Ollama model.</p>
            <div className="settings-model-badges"><span>Default: <code>{DEFAULT_OLLAMA_MODEL}</code></span><span>Fallback: <code>{FALLBACK_OLLAMA_MODEL}</code></span></div>
            <label className="ai-model-field">Model name<input value={ollamaModel} onChange={(event) => setOllamaModel(event.target.value)} onBlur={() => setOllamaModel((current) => current.trim() || DEFAULT_OLLAMA_MODEL)} placeholder={DEFAULT_OLLAMA_MODEL} /></label>
            <div className="settings-ai-actions"><button disabled={settingsAiBusy} onClick={() => void handleCheckOllamaStatus()} type="button"><MainIcon name="chart" />Check</button><button onClick={() => void handleOpenOllamaDownload()} type="button"><MainIcon name="timer" />Install Ollama</button><button onClick={() => void handlePullOllamaModel()} type="button"><MainIcon name="overlay" />Pull model</button></div>
            <p aria-live="polite" className="settings-ai-status">{settingsAiStatus ?? " "}</p>
          </section>

        </div> : null}

        {activeSection === "profile" ? <div className="settings-grid profile-grid">
          <section className="dashboard-panel profile-settings-panel profile-identity-panel">
            <div className="profile-settings-header">
              <span className="profile-settings-avatar">{profileInitials}</span>
              <div>
                <PanelKicker icon="settings" label="Profile" />
                <h2>{displayName}</h2>
                <p>Your name is used for greetings and the sidebar identity.</p>
              </div>
            </div>

            <div className="profile-settings-row">
              <label className="settings-field">Display name<input value={appSettings.userName} onChange={(event) => updateAppSettings({ userName: event.target.value })} placeholder="Prithiv Raj" /></label>
              <button className="settings-action-button" onClick={() => updateAppSettings({ userName: appSettings.userName.trim() })} type="button"><MainIcon name="pen" />Save</button>
            </div>
          </section>

          <section className="dashboard-panel profile-settings-panel profile-theme-panel">
            <div className="profile-theme-heading">
              <div><strong>Theme</strong><p>Pick the visual language for the main window and overlay.</p></div>
              <span>{activeTheme.label}</span>
            </div>
            <div className="theme-options profile-theme-options">
              {themeOptions.map((theme) => <button aria-pressed={theme.id === themeId} className={theme.id === themeId ? "is-active" : ""} key={theme.id} onClick={() => updateAppSettings({ themeId: theme.id })} type="button"><span className="theme-swatch-row">{theme.swatches.map((swatch) => <i key={swatch} style={{ background: swatch }} />)}</span><strong>{theme.label}</strong><small>{theme.description}</small></button>)}
            </div>
          </section>

          <section className="dashboard-panel profile-settings-panel profile-overlay-panel">
            <div className="overlay-mode-setting">
              <div><strong>Resting overlay</strong><p>Choose what the timer collapses to after starting.</p></div>
              <div className="overlay-mode-options">
                <button aria-pressed={appSettings.preferredOverlayMode === "mini"} className={appSettings.preferredOverlayMode === "mini" ? "is-active" : ""} onClick={() => updateAppSettings({ preferredOverlayMode: "mini" })} type="button">Mini</button>
                <button aria-pressed={appSettings.preferredOverlayMode === "tiny"} className={appSettings.preferredOverlayMode === "tiny" ? "is-active" : ""} onClick={() => updateAppSettings({ preferredOverlayMode: "tiny" })} type="button">Tiny</button>
              </div>
            </div>
            <label className="settings-slider-field">Overlay transparency <strong>{formatTransparency(appSettings.overlayTransparency)}</strong><input aria-label="Overlay transparency" max="100" min="50" onChange={(event) => updateAppSettings({ overlayTransparency: Number(event.target.value) / 100 })} type="range" value={Math.round(appSettings.overlayTransparency * 100)} /></label>
            <div className="settings-slider-scale"><span>Subtle</span><span>Solid</span></div>
          </section>

          <section className="dashboard-panel profile-settings-panel review-settings-panel profile-review-panel">
            <PanelKicker icon="clock" label="Review" />
            <h2>Tracked time</h2>
            <div className="totals-list"><p><span>All entries</span><strong>{formatDuration(totalDuration(allEntries))}</strong></p>{dailySummaries.slice(0, 5).map((summary) => <p key={summary.date}><span>{summary.date}</span><strong>{formatDuration(summary.durationSeconds)}</strong></p>)}</div>
            <div className="settings-review-bar"><span /></div>
          </section>
        </div> : null}

        {activeSection === "dev" ? <section className="dashboard-panel dev-ai-panel"><div className="section-title"><h2>AI note requests</h2><span>{aiSuggestionStats.total} total</span></div><div className="dev-ai-metrics"><p><span>Average response</span><strong>{formatDurationMs(aiSuggestionStats.averageDurationMs)}</strong></p><p><span>Accepted</span><strong>{aiSuggestionStats.accepted}</strong></p><p><span>Rejected</span><strong>{aiSuggestionStats.rejected}</strong></p><p><span>Copied</span><strong>{aiSuggestionStats.copied}</strong></p><p><span>Pending</span><strong>{aiSuggestionStats.pending}</strong></p></div><h3 className="dev-ai-subheading">Improved notes</h3><div className="dev-ai-list">
          {improvedAiSuggestions.length === 0 ? <p className="empty-state">AI request telemetry will appear after the first note improvement.</p> : improvedAiSuggestions.slice(0, 25).map((suggestion) => <article key={suggestion.id}><div><strong>{suggestion.model}</strong><p>{suggestion.inputText}</p><small>Created {formatEntryDateTime(suggestion.createdAt)}{suggestion.statusUpdatedAt ? ` · ${formatAiStatus(suggestion.status)} ${formatEntryDateTime(suggestion.statusUpdatedAt)}` : ""}</small></div><span>{formatDurationMs(normalizeSuggestionDuration(suggestion))}</span><b className={`dev-ai-status is-${suggestion.status}`}>{suggestion.status}</b></article>)}
        </div></section> : null}
      </section>

      {isTaskComposerOpen ? <div className="dashboard-modal-backdrop" onMouseDown={() => setIsTaskComposerOpen(false)} role="presentation"><section className="project-composer" aria-modal="true" role="dialog" aria-labelledby="new-task-heading" onMouseDown={(event) => event.stopPropagation()}><button aria-label="Close new task" className="modal-close" onClick={() => setIsTaskComposerOpen(false)}>×</button><p className="panel-kicker">New task</p><h2 id="new-task-heading">What needs your attention?</h2><form onSubmit={handleCreateTask}><label>Task name<input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Data Pipeline Optimization" /></label><label>Projects <span className="project-options">{projects.length ? projects.map((project) => <label key={project.id}><input checked={taskProjectIds.includes(project.id)} type="checkbox" onChange={(event) => setTaskProjectIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} />{project.title}</label>) : <small className="field-hint">No projects yet. You can add one from Projects.</small>}</span><small className="field-hint">Optional — choose one or more projects.</small></label><label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="development, research" /></label><label>Starting note<textarea value={defaultNote} onChange={(event) => setDefaultNote(event.target.value)} placeholder="Optional context for this task" /></label><button className="new-project-button" type="submit"><MainIcon name="plus" />Create task</button></form></section></div> : null}

      {isProjectComposerOpen ? <div className="dashboard-modal-backdrop" onMouseDown={() => setIsProjectComposerOpen(false)} role="presentation"><section className="project-composer" aria-modal="true" role="dialog" aria-labelledby="new-project-heading" onMouseDown={(event) => event.stopPropagation()}><button aria-label="Close new project" className="modal-close" onClick={() => setIsProjectComposerOpen(false)}>×</button><p className="panel-kicker">New project</p><h2 id="new-project-heading">Organize related tasks.</h2><form onSubmit={handleCreateProject}><label>Project name<input autoFocus required value={newProjectTitle} onChange={(event) => setNewProjectTitle(event.target.value)} placeholder="Client work" /></label><button className="new-project-button" type="submit"><MainIcon name="plus" />Create project</button></form></section></div> : null}

      {isEntryComposerOpen ? <div className="dashboard-modal-backdrop" role="presentation" onMouseDown={handleCloseEntryEditor}><section aria-labelledby="entry-editor-title" aria-modal="true" className="project-composer entry-composer" role="dialog" onMouseDown={(event) => event.stopPropagation()}><button aria-label="Close entry editor" className="modal-close" onClick={handleCloseEntryEditor}>×</button><p className="panel-kicker">{editingEntry ? "Edit entry" : "New entry"}</p><h2 id="entry-editor-title">{editingEntry ? "Correct tracked time." : "Log completed work."}</h2><form onSubmit={handleSaveEntry}><label>Task<select required value={entryTaskId} onChange={(event) => setEntryTaskId(event.target.value)}>{(editingEntry ? allTasks : tasks).map((task) => <option key={task.id} value={task.id}>{task.title}{task.archived ? " (archived)" : ""}</option>)}</select></label><div className="composer-row"><label>Start<input required type="datetime-local" value={entryStartedAt} onChange={(event) => setEntryStartedAt(event.target.value)} /></label><label>End<input required type="datetime-local" value={entryEndedAt} onChange={(event) => setEntryEndedAt(event.target.value)} /></label></div><label>Note<textarea value={entryNote} onChange={(event) => setEntryNote(event.target.value)} /></label><div className="composer-actions"><button className="new-project-button" type="submit">{editingEntry ? "Save changes" : "Create entry"}</button><button type="button" onClick={handleCloseEntryEditor}>Cancel</button></div></form></section></div> : null}
    </main>
  );
}

function TaskIdentityIcon({
  className = "task-identity-icon",
  identity,
  task,
  taskId,
  title
}: {
  className?: string;
  identity?: TaskVisualIdentity;
  task?: Task | null;
  taskId?: string;
  title?: string;
}) {
  const visual = identity ?? getTaskVisual(task, taskId, title);
  return <span className={`${className} task-tone-${visual.tone}`}><MainIcon name={visual.icon} /></span>;
}

function MetricPill({ icon, label, value, delta }: { icon: MainIconName; label: string; value: string; delta: string }) {
  return <article><span><MainIcon name={icon} /></span><div><p>{label}</p><strong>{value}</strong><small>{delta}</small></div></article>;
}

function SectionNumber({ number, title }: { number: string; title: string }) {
  return <h2 className="time-section-title"><span>{number}</span>{title}</h2>;
}

function InsightRanking({ rows, totalSeconds }: { rows: InsightSummaryRow[]; totalSeconds: number }) {
  return <div className="time-ranking-list">
    {rows.length === 0 ? <p className="empty-state">Tracked time will appear here.</p> : rows.slice(0, 6).map((row) => <article key={row.id}><span className={`time-rank-icon time-tone-bg-${row.tone}`}><MainIcon name={row.icon} /></span><div><div><strong>{row.title}</strong><small>{formatCompactDuration(row.durationSeconds)}</small><b>{totalSeconds ? row.percent : 0}%</b></div><i><em className={`task-tone-${row.tone}`} style={cssVars({ "--bar-width": `${row.percent}%` })} /></i><p>{row.meta}</p></div></article>)}
    {rows.length ? <footer><span>Total</span><strong>{formatCompactDuration(totalSeconds)}</strong></footer> : null}
  </div>;
}

function HighlightItem({ icon, label, value, detail }: { icon: MainIconName; label: string; value: string; detail: string }) {
  return <article><span><MainIcon name={icon} />{label}</span><strong>{value}</strong><p>{detail}</p></article>;
}

function renderStackedTaskSegments(bucket: InsightBucket, taskRows: InsightSummaryRow[]): ReactNode {
  if (!bucket.totalSeconds) {
    return null;
  }

  return bucket.durations.map((durationSeconds, index) => {
    const taskRow = taskRows[index];
    if (!taskRow || durationSeconds <= 0) {
      return null;
    }

    return <i className={`time-tone-bg-${taskRow.tone}`} key={`${bucket.key}-${taskRow.id}`} style={cssVars({ "--segment-height": `${Math.max(7, durationSeconds / bucket.totalSeconds * 100)}%` })} />;
  });
}

function buildTimeInsights(entries: TimeEntry[], tasks: Task[], projects: Project[], mode: TimeViewMode): TimeInsights {
  const range = getDateRange(mode);
  const rangeMs = range.end.getTime() - range.start.getTime();
  const previousRange = { start: new Date(range.start.getTime() - rangeMs), end: range.start };
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const periodEntries = entries.filter((entry) => isEntryInRange(entry, range.start, range.end));
  const previousEntries = entries.filter((entry) => isEntryInRange(entry, previousRange.start, previousRange.end));
  const totalSeconds = periodEntries.reduce((total, entry) => total + entry.durationSeconds, 0);
  const previousTotalSeconds = previousEntries.reduce((total, entry) => total + entry.durationSeconds, 0);
  const taskTotals = new Map<string, InsightSummaryRow>();
  const projectTotals = new Map<string, InsightSummaryRow>();
  const dayTotals = new Map<string, { label: string; durationSeconds: number }>();
  let focusSeconds = 0;

  for (const entry of periodEntries) {
    const task = taskById.get(entry.taskId);
    const taskTitle = task?.title ?? "Archived task";
    const taskVisual = getTaskVisual(task, entry.taskId, taskTitle);
    const projectsForTask = task?.projectIds.map((id) => projectById.get(id)?.title).filter((title): title is string => Boolean(title)) ?? [];
    const taskRow = taskTotals.get(entry.taskId) ?? {
      id: entry.taskId,
      title: taskTitle,
      meta: projectsForTask.length ? projectsForTask.join(" · ") : "No project",
      durationSeconds: 0,
      percent: 0,
      icon: taskVisual.icon,
      tone: taskVisual.tone
    };
    taskRow.durationSeconds += entry.durationSeconds;
    taskTotals.set(entry.taskId, taskRow);

    const allocationTargets = projectsForTask.length ? projectsForTask : ["No project"];
    const allocatedSeconds = entry.durationSeconds / allocationTargets.length;
    allocationTargets.forEach((projectTitle, index) => {
      const projectRow = projectTotals.get(projectTitle) ?? {
        id: projectTitle,
        title: projectTitle,
        meta: `${taskTitle}${allocationTargets.length > 1 ? " shared" : ""}`,
        durationSeconds: 0,
        percent: 0,
        icon: projectSummaryIcon(projectTotals.size + index),
        tone: stableTone(projectTitle)
      };
      projectRow.durationSeconds += allocatedSeconds;
      projectTotals.set(projectTitle, projectRow);
    });

    if (entry.durationSeconds >= 25 * 60) {
      focusSeconds += entry.durationSeconds;
    }

    const dayKey = toLocalDateKey(new Date(entry.startedAt));
    const day = dayTotals.get(dayKey) ?? { label: formatDayHighlight(entry.startedAt), durationSeconds: 0 };
    day.durationSeconds += entry.durationSeconds;
    dayTotals.set(dayKey, day);
  }

  const taskRows = sortSummaryRows(taskTotals, totalSeconds);
  const projectRows = sortSummaryRows(projectTotals, totalSeconds);
  const buckets = buildInsightBuckets(range, mode, periodEntries, taskRows.slice(0, 6));
  const heatmap = buildHeatmap(range, mode, periodEntries);
  const daysInRange = Math.max(1, Math.round(rangeMs / 86_400_000));
  const sessionRows = [...periodEntries]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, 7)
    .map((entry) => {
      const task = taskById.get(entry.taskId);
      const taskTitle = task?.title ?? "Archived task";
      const taskVisual = getTaskVisual(task, entry.taskId, taskTitle);
      const projectNames = task?.projectIds.map((id) => projectById.get(id)?.title).filter((title): title is string => Boolean(title)) ?? [];
      return {
        id: entry.id,
        date: formatShortDate(entry.startedAt),
        task: taskTitle,
        taskIcon: taskVisual.icon,
        taskTone: taskVisual.tone,
        project: projectNames.join(" · ") || "No project",
        durationSeconds: entry.durationSeconds,
        note: entry.note
      };
    });
  const bestDay = [...dayTotals.values()].sort((left, right) => right.durationSeconds - left.durationSeconds)[0] ?? null;
  const longestEntry = [...periodEntries].sort((left, right) => right.durationSeconds - left.durationSeconds)[0] ?? null;

  return {
    range,
    previousTotalSeconds,
    totalSeconds,
    dailyAverageSeconds: totalSeconds / daysInRange,
    focusRatio: totalSeconds ? Math.round(focusSeconds / totalSeconds * 100) : 0,
    buckets,
    taskRows,
    projectRows,
    sessionRows,
    heatmap,
    bestDay,
    longestEntry,
    topTask: taskRows[0] ?? null
  };
}

function buildWeeklyTimesheet(entries: TimeEntry[], tasks: Task[], projects: Project[]): WeeklyTimesheet {
  const range = getDateRange("week");
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(range.start, index);
    return {
      date,
      label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
      shortDate: new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" }).format(date)
    };
  });
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const rows = new Map<string, TimesheetRow>();
  const dayTotals = Array.from({ length: 7 }, () => 0);
  let notesCount = 0;

  for (const entry of entries.filter((candidate) => isEntryInRange(candidate, range.start, range.end))) {
    const task = taskById.get(entry.taskId);
    const taskTitle = task?.title ?? "Archived task";
    const taskVisual = getTaskVisual(task, entry.taskId, taskTitle);
    const startedAt = new Date(entry.startedAt);
    const dayIndex = Math.floor((startOfDay(startedAt).getTime() - range.start.getTime()) / 86_400_000);
    if (dayIndex < 0 || dayIndex >= days.length) {
      continue;
    }

    const row = rows.get(entry.taskId) ?? {
      taskId: entry.taskId,
      title: taskTitle,
      icon: taskVisual.icon,
      tone: taskVisual.tone,
      projects: task?.projectIds.map((id) => projectById.get(id)?.title).filter((title): title is string => Boolean(title)) ?? [],
      tags: task?.tags ?? [],
      cells: Array.from({ length: 7 }, () => ({ durationSeconds: 0, entryCount: 0 })),
      totalSeconds: 0
    };
    row.cells[dayIndex].durationSeconds += entry.durationSeconds;
    row.cells[dayIndex].entryCount += 1;
    row.totalSeconds += entry.durationSeconds;
    rows.set(entry.taskId, row);
    dayTotals[dayIndex] += entry.durationSeconds;
    if (entry.note.trim()) {
      notesCount += 1;
    }
  }

  const sortedRows = [...rows.values()].sort((left, right) => {
    if (right.totalSeconds !== left.totalSeconds) {
      return right.totalSeconds - left.totalSeconds;
    }
    return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
  });

  return {
    range,
    days,
    rows: sortedRows,
    dayTotals,
    totalSeconds: dayTotals.reduce((total, day) => total + day, 0),
    notesCount
  };
}

function buildInsightBuckets(range: DateRange, mode: TimeViewMode, entries: TimeEntry[], taskRows: InsightSummaryRow[]): InsightBucket[] {
  const buckets = createBucketShells(range, mode);
  const taskIndexById = new Map(taskRows.map((row, index) => [row.id, index]));

  for (const entry of entries) {
    const bucketIndex = findBucketIndex(range, mode, new Date(entry.startedAt));
    const taskIndex = taskIndexById.get(entry.taskId);
    if (bucketIndex < 0 || !buckets[bucketIndex] || taskIndex === undefined) {
      continue;
    }
    buckets[bucketIndex].durations[taskIndex] += entry.durationSeconds;
    buckets[bucketIndex].totalSeconds += entry.durationSeconds;
  }

  return buckets;
}

function buildHeatmap(range: DateRange, mode: TimeViewMode, entries: TimeEntry[]) {
  const bucketCount = createBucketShells(range, mode).length;
  const heatmap = [
    { label: "Morning", periods: Array.from({ length: bucketCount }, () => 0) },
    { label: "Afternoon", periods: Array.from({ length: bucketCount }, () => 0) },
    { label: "Evening", periods: Array.from({ length: bucketCount }, () => 0) }
  ];

  for (const entry of entries) {
    const startedAt = new Date(entry.startedAt);
    const bucketIndex = findBucketIndex(range, mode, startedAt);
    if (bucketIndex < 0 || bucketIndex >= bucketCount) {
      continue;
    }
    const hour = startedAt.getHours();
    const rowIndex = hour < 12 ? 0 : hour < 17 ? 1 : 2;
    heatmap[rowIndex].periods[bucketIndex] += entry.durationSeconds;
  }

  return heatmap;
}

function createBucketShells(range: DateRange, mode: TimeViewMode): InsightBucket[] {
  if (mode === "day") {
    return ["Morning", "Afternoon", "Evening", "Night"].map((label, index) => ({ key: `${label}-${index}`, label, durations: Array.from({ length: 6 }, () => 0), totalSeconds: 0 }));
  }

  if (mode === "week") {
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(range.start, index);
      return { key: toLocalDateKey(date), label: new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" }).format(date), durations: Array.from({ length: 6 }, () => 0), totalSeconds: 0 };
    });
  }

  const buckets: InsightBucket[] = [];
  let cursor = new Date(range.start);
  let index = 0;
  while (cursor < range.end) {
    const next = new Date(Math.min(addDays(cursor, 7).getTime(), range.end.getTime()));
    buckets.push({
      key: `${toLocalDateKey(cursor)}-${index}`,
      label: `${new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(cursor)}-${new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(addDays(next, -1))}`,
      durations: Array.from({ length: 6 }, () => 0),
      totalSeconds: 0
    });
    cursor = next;
    index += 1;
  }
  return buckets;
}

function findBucketIndex(range: DateRange, mode: TimeViewMode, date: Date): number {
  if (mode === "day") {
    const hour = date.getHours();
    if (hour >= 5 && hour < 12) {
      return 0;
    }
    if (hour >= 12 && hour < 17) {
      return 1;
    }
    if (hour >= 17 && hour < 21) {
      return 2;
    }
    return 3;
  }

  const days = Math.floor((startOfDay(date).getTime() - range.start.getTime()) / 86_400_000);
  return mode === "week" ? days : Math.floor(days / 7);
}

function sortSummaryRows(rows: Map<string, InsightSummaryRow>, totalSeconds: number): InsightSummaryRow[] {
  return [...rows.values()]
    .sort((left, right) => {
      if (right.durationSeconds !== left.durationSeconds) {
        return right.durationSeconds - left.durationSeconds;
      }
      return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
    })
    .map((row) => ({ ...row, durationSeconds: Math.round(row.durationSeconds), percent: totalSeconds ? Math.round(row.durationSeconds / totalSeconds * 100) : 0 }));
}

function getDateRange(mode: TimeViewMode, today = new Date()): DateRange {
  if (mode === "day") {
    const start = startOfDay(today);
    const end = addDays(start, 1);
    return { start, end, label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(start) };
  }

  if (mode === "week") {
    const start = startOfWeek(today);
    const end = addDays(start, 7);
    return { start, end, label: `${formatRangeDate(start)} - ${formatRangeDate(addDays(end, -1))}` };
  }

  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return { start, end, label: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(start) };
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const daysFromMonday = (day + 6) % 7;
  return addDays(startOfDay(date), -daysFromMonday);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isEntryInRange(entry: TimeEntry, start: Date, end: Date): boolean {
  const startedAt = new Date(entry.startedAt).getTime();
  return startedAt >= start.getTime() && startedAt < end.getTime();
}

function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatRangeDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDayHighlight(value: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(value));
}

function formatCompactDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0 && minutes === 0) {
    return "0h 00m";
  }
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatTimesheetDuration(totalSeconds: number): string {
  const minutesTotal = Math.max(0, Math.round(totalSeconds / 60));
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatPercentDelta(currentSeconds: number, previousSeconds: number): string {
  if (!previousSeconds && currentSeconds) {
    return "new time tracked";
  }
  if (!currentSeconds && !previousSeconds) {
    return "no prior time";
  }
  const delta = Math.round((currentSeconds - previousSeconds) / Math.max(1, previousSeconds) * 100);
  return `${delta >= 0 ? "+" : ""}${delta}% vs previous`;
}

function buildReflectionCopy(insights: TimeInsights): string {
  if (!insights.totalSeconds) {
    return "No tracked time in this range yet. Start a timer or add entries to see patterns across your work.";
  }
  const topTask = insights.topTask?.title ?? "your top task";
  const focus = insights.focusRatio >= 60 ? "strong focus blocks" : "a lighter focus mix";
  return `${topTask} led this range with ${focus} and ${insights.sessionRows.length} completed sessions.`;
}

function normalizeHeat(durationSeconds: number, heatmap: Array<{ periods: number[] }>): number {
  const max = Math.max(1, ...heatmap.flatMap((row) => row.periods));
  return durationSeconds / max;
}

function getTaskVisual(task?: Task | null, fallbackId = "", fallbackTitle = "Task"): TaskVisualIdentity {
  const title = (task?.title ?? fallbackTitle).trim() || "Task";
  const seed = task?.id || fallbackId || title;
  return {
    icon: taskIconFromTitle(title, seed),
    tone: stableTone(seed)
  };
}

function taskIconFromTitle(title: string, seed: string): MainIconName {
  const normalized = title.toLocaleLowerCase();
  const match = TASK_ICON_KEYWORDS.find(({ keywords }) => keywords.some((keyword) => normalized.includes(keyword)));
  if (match) {
    return match.icon;
  }
  return TASK_ICON_FALLBACKS[stableHash(`${title}:${seed}`) % TASK_ICON_FALLBACKS.length];
}

function projectSummaryIcon(index: number): MainIconName {
  return ["globe", "chart", "users", "book", "settings", "more"][index % 6] as MainIconName;
}

function stableTone(seed: string): number {
  return stableHash(seed || "task") % 6;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function cssVars(values: Record<string, string>): CSSProperties {
  return values as CSSProperties;
}

type MainIconName = "calendar" | "chevron" | "clock" | "comment" | "filter" | "globe" | "home" | "info" | "list" | "more" | "note" | "overlay" | "pen" | "play" | "plus" | "search" | "settings" | "sparkle" | "target" | "timer" | "trend" | "trophy" | "users" | "briefcase" | "book" | "chart" | "code" | "phone" | "shield" | "document";

const TASK_ICON_KEYWORDS: Array<{ icon: MainIconName; keywords: string[] }> = [
  { icon: "phone", keywords: ["call", "phone", "zoom", "meet"] },
  { icon: "users", keywords: ["standup", "sync", "interview", "workshop", "review"] },
  { icon: "code", keywords: ["code", "dev", "develop", "implement", "bug", "fix", "api", "frontend", "backend"] },
  { icon: "chart", keywords: ["data", "report", "analysis", "analytics", "metric", "dashboard"] },
  { icon: "document", keywords: ["doc", "write", "draft", "spec", "proposal", "brief"] },
  { icon: "book", keywords: ["read", "research", "learn", "study", "explore"] },
  { icon: "target", keywords: ["plan", "roadmap", "strategy", "goal", "launch"] },
  { icon: "shield", keywords: ["security", "audit", "risk", "compliance"] },
  { icon: "timer", keywords: ["timer", "timesheet", "schedule"] },
  { icon: "briefcase", keywords: ["client", "sales", "invoice", "admin", "ops"] }
];

const TASK_ICON_FALLBACKS: MainIconName[] = ["briefcase", "code", "chart", "document", "target", "book"];

function PanelKicker({ icon, label }: { icon: MainIconName; label: string }) {
  return <p className="panel-kicker settings-panel-kicker"><MainIcon name={icon} />{label}</p>;
}

function MainIcon({ name }: { name: MainIconName }) {
  const paths: Record<MainIconName, ReactNode> = {
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    comment: <><path d="M5 6h14v9H9l-4 4z" /><path d="M8 10h8" /></>,
    filter: <path d="M5 5h14l-5.5 6v5l-3 2v-7z" />,
    globe: <><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4a12 12 0 0 1 0 16M12 4a12 12 0 0 0 0 16" /></>,
    home: <><path d="m4 11 8-7 8 7v9H4z" /><path d="M9 20v-6h6v6" /></>,
    info: <><circle cx="12" cy="12" r="8" /><path d="M12 11v5M12 8h.01" /></>,
    list: <><path d="M9 6h10M9 12h10M9 18h10" /><circle cx="4" cy="6" r=".8" fill="currentColor" /><circle cx="4" cy="12" r=".8" fill="currentColor" /><circle cx="4" cy="18" r=".8" fill="currentColor" /></>,
    more: <><circle cx="12" cy="5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="19" r="1.2" fill="currentColor" /></>,
    note: <><path d="M6 3h9l3 3v15H6zM15 3v4h4M9 12h6M9 16h6" /></>,
    overlay: <><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M8 9h8M8 13h5" /></>,
    pen: <><path d="m5 19 3.5-.8L19 7.7 16.3 5 5.8 15.5zM14.8 6.5l2.7 2.7" /></>,
    play: <path d="m9 6 8 6-8 6z" fill="currentColor" stroke="none" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7.5 7.5 0 0 0-.1-1l2-1.5-2-3.5-2.3.9a7 7 0 0 0-1.7-1L14.5 3h-5L9 5.9a7 7 0 0 0-1.7 1L5 6 3 9.5 5 11a7.5 7.5 0 0 0 0 2l-2 1.5L5 18l2.3-.9a7 7 0 0 0 1.7 1l.5 2.9h5l.4-2.9a7 7 0 0 0 1.7-1l2.3.9 2-3.5-2-1.5c.1-.3.1-.7.1-1Z" /></>,
    sparkle: <path d="M12 3l1.6 5 5 1.6-5 1.6-1.6 5-1.6-5-5-1.6 5-1.6zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="M15 9l4-4M16 5h3v3" /></>,
    timer: <><rect x="4" y="4" width="16" height="16" rx="5" /><path d="M12 8v4l2.5 2.5M9 2h6" /></>,
    trend: <path d="M4 16l5-5 4 4 7-8M15 7h5v5" />,
    trophy: <><path d="M8 5h8v4a4 4 0 0 1-8 0z" /><path d="M8 7H5a3 3 0 0 0 3 4M16 7h3a3 3 0 0 1-3 4M12 13v4M9 21h6M10 17h4" /></>,
    users: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3 20a6 6 0 0 1 12 0M14 17.5a5 5 0 0 1 7 2.5" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M8 7V5h8v2M3 12h18M10 12v2h4v-2" /></>,
    book: <><path d="M5 4h10a4 4 0 0 1 4 4v12H8a3 3 0 0 0-3-3z" /><path d="M5 4v13" /></>,
    chart: <><path d="M5 20V11h4v9M10 20V5h4v15M15 20v-8h4v8M3 20h18" /></>,
    code: <><path d="m9 8-4 4 4 4M15 8l4 4-4 4" /><path d="m13 6-2 12" /></>,
    phone: <path d="M7.5 4.5 5.3 6.7c-1 1 1.1 6.2 4.5 9.6 3.4 3.4 8.6 5.5 9.6 4.5l2.2-2.2-3.2-3.2-2.1 1.3c-1.1-.5-2.2-1.3-3.2-2.3s-1.8-2.1-2.3-3.2l1.3-2.1z" />,
    shield: <path d="M12 3 19 6v5c0 4.5-2.8 7.5-7 10-4.2-2.5-7-5.5-7-10V6z" />,
    document: <><path d="M6 3h9l3 3v15H6zM15 3v4h4M9 13h6M9 17h6" /></>
  };
  return <svg aria-hidden="true" className="main-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function toDateTimeLocalValue(value: string): string {
  const date = new Date(value);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function readStoredOllamaModel(): string {
  return window.localStorage.getItem(OLLAMA_MODEL_STORAGE_KEY)?.trim() || DEFAULT_OLLAMA_MODEL;
}

function getInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("");
  return initials || "R";
}

function formatTransparency(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function readClockMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function normalizeSuggestionDuration(suggestion: NoteAiSuggestion): number {
  return typeof suggestion.durationMs === "number" && Number.isFinite(suggestion.durationMs) ? suggestion.durationMs : -1;
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 0) {
    return "n/a";
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

function formatAiStatus(status: NoteAiSuggestion["status"]): string {
  if (status === "accepted") {
    return "Accepted";
  }
  if (status === "rejected") {
    return "Rejected";
  }
  if (status === "copied") {
    return "Copied";
  }
  return "Pending";
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

function getAiSuggestionSummary(suggestion: NoteAiSuggestion): string {
  return `${getAiSuggestionButtonLabel(suggestion)} · ${formatDurationMs(normalizeSuggestionDuration(suggestion))}`;
}
