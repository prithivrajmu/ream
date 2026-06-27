import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_OLLAMA_MODEL, FALLBACK_OLLAMA_MODEL, OLLAMA_MODEL_STORAGE_KEY, type ImprovedNoteOutput } from "../../shared/ai";
import { createNoteAiSuggestion, updateNoteAiSuggestionStatus } from "../../shared/aiSuggestionRepository";
import { db } from "../../shared/db";
import type { ActiveTimer, Project, Task, TimeEntry } from "../../shared/domain";
import { importTimesheetData, readAllExportData } from "../../shared/exportRepository";
import {
  buildDailySummaries,
  createTimesheetExport,
  entriesToCsv,
  parseTimesheetExport,
  serializeTimesheetExport
} from "../../shared/reporting";
import { archiveProject, createProject, listActiveProjects, updateProject } from "../../shared/projectRepository";
import { createTask, listActiveTasks, updateTask } from "../../shared/taskRepository";
import { parseTags } from "../../shared/taskValidation";
import { formatDuration } from "../../shared/time";
import { activeTimerElapsedSeconds, createTimeEntry, deleteTimeEntry, getActiveTimer, startTimer, stopTimer, updateActiveTimerNote, updateTimeEntry } from "../../shared/timerRepository";
import { downloadTextFile, formatEntryDateTime, totalDuration } from "../rendererUtils";
import { themeOptions, type ThemeId } from "../themeOptions";
import reamIcon from "../assets/ream-icon.png";

interface MainViewProps {
  themeId: ThemeId;
  setThemeId: (themeId: ThemeId) => void;
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

export function MainView({ themeId, setThemeId }: MainViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [allEntries, setAllEntries] = useState<TimeEntry[]>([]);
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
  const [activeSection, setActiveSection] = useState<"home" | "entries" | "tasks" | "notes" | "projects" | "backup">("home");
  const [isTaskComposerOpen, setIsTaskComposerOpen] = useState(false);
  const [isProjectComposerOpen, setIsProjectComposerOpen] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [quickCapture, setQuickCapture] = useState("");
  const [ollamaModel, setOllamaModel] = useState(() => readStoredOllamaModel());
  const [aiLoadingNoteId, setAiLoadingNoteId] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<AiNotePreview | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const taskById = useMemo(() => new Map(allTasks.map((task) => [task.id, task])), [allTasks]);
  const projectById = useMemo(() => new Map(allProjects.map((project) => [project.id, project])), [allProjects]);
  const archivedTasks = useMemo(() => allTasks.filter((task) => task.archived), [allTasks]);
  const archivedProjects = useMemo(() => allProjects.filter((project) => project.archived), [allProjects]);
  const activeTask = activeTimer ? taskById.get(activeTimer.taskId) : null;
  const dailySummaries = useMemo(() => buildDailySummaries(allEntries), [allEntries]);
  const recentEntries = useMemo(
    () => [...allEntries].sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    [allEntries]
  );
  const noteEntries = useMemo(() => recentEntries.filter((entry) => entry.note.trim()), [recentEntries]);
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
    const [nextTasks, nextProjects, nextActiveTimer, exportData] = await Promise.all([
      listActiveTasks(db),
      listActiveProjects(db),
      getActiveTimer(db),
      readAllExportData(db)
    ]);

    setTasks(nextTasks);
    setProjects(nextProjects);
    setAllProjects(exportData.projects);
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

  useEffect(() => {
    window.localStorage.setItem(OLLAMA_MODEL_STORAGE_KEY, ollamaModel.trim() || DEFAULT_OLLAMA_MODEL);
  }, [ollamaModel]);

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
      if (!window.timesheetDesktop?.improveNoteWithAi) {
        throw new Error("AI is only available in the desktop app.");
      }

      const projectName = task.projectIds.map((id) => projectById.get(id)?.title).filter(Boolean).join(", ");
      const result = await window.timesheetDesktop.improveNoteWithAi({
        noteText,
        taskTitle: task.title,
        projectName,
        tags: task.tags,
        model: ollamaModel.trim() || DEFAULT_OLLAMA_MODEL
      });
      const savedSuggestion = await createNoteAiSuggestion(db, {
        noteId: entry.id,
        model: result.model,
        inputText: noteText,
        outputJson: result.output
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
      await updateNoteAiSuggestionStatus(db, preview.suggestionId, "rejected");
      setAiPreview(null);
    } catch (rejectError) {
      setAiError(rejectError instanceof Error ? rejectError.message : "Unable to reject AI suggestion.");
    }
  }

  async function handleCopyAiSuggestion(preview: AiNotePreview) {
    setAiError(null);
    try {
      await navigator.clipboard.writeText(preview.output.clean_note);
      await updateNoteAiSuggestionStatus(db, preview.suggestionId, "copied");
    } catch (copyError) {
      setAiError(copyError instanceof Error ? copyError.message : "Unable to copy AI suggestion.");
    }
  }

  function renderImproveNoteButton(entry: TimeEntry): ReactNode {
    if (!entry.note.trim()) {
      return null;
    }

    return <button className="ai-note-button" disabled={aiLoadingNoteId === entry.id} onClick={() => void handleImproveNote(entry)}>{aiLoadingNoteId === entry.id ? "Improving..." : "Improve with AI"}</button>;
  }

  function renderAiPreview(entry: TimeEntry): ReactNode {
    const preview = aiPreview?.entryId === entry.id ? aiPreview : null;
    if (!preview) {
      return null;
    }

    return <div className="ai-note-preview"><section><h3>Raw note</h3><p>{preview.rawNote}</p></section><section><h3>AI suggestion</h3><p>{preview.output.clean_note}</p><dl><div><dt>Summary</dt><dd>{preview.output.summary}</dd></div><div><dt>Next steps</dt><dd>{preview.output.next_steps.length ? preview.output.next_steps.join("; ") : "None"}</dd></div><div><dt>Blockers</dt><dd>{preview.output.blockers.length ? preview.output.blockers.join("; ") : "None"}</dd></div><div><dt>Tags</dt><dd>{preview.output.tags.length ? preview.output.tags.join(", ") : "None"}</dd></div></dl><small>Model: {preview.model}</small><div className="ai-note-actions"><button onClick={() => void handleAcceptAiSuggestion(preview)}>Accept</button><button onClick={() => void handleCopyAiSuggestion(preview)}>Copy suggestion</button><button onClick={() => void handleRejectAiSuggestion(preview)}>Reject</button></div></section></div>;
  }

  async function handleExportJson() {
    setError(null);

    try {
      const exportData = await readAllExportData(db);
      downloadTextFile(
        `timesheet-export-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json",
        serializeTimesheetExport(createTimesheetExport(exportData.tasks, exportData.projects, exportData.timeEntries))
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

  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  const navigation: Array<{ id: typeof activeSection; label: string; icon: MainIconName }> = [
    { id: "home", label: "Home", icon: "home" },
    { id: "entries", label: "Entries", icon: "clock" },
    { id: "tasks", label: "Tasks", icon: "list" },
    { id: "notes", label: "Notes", icon: "note" },
    { id: "projects", label: "Projects", icon: "briefcase" },
    { id: "backup", label: "Backup & settings", icon: "settings" }
  ];

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
    return null;
  })();

  const activeTheme = themeOptions.find((theme) => theme.id === themeId) ?? themeOptions[0];

  return (
    <main className={`dashboard-shell theme-${themeId}`}>
      <aside className="dashboard-sidebar">
        <div className="brand-lockup"><span className="brand-mark"><img alt="Ream" src={reamIcon} /></span><div><strong>Ream</strong><p>Time on what matters.</p></div></div>
        <nav className="dashboard-nav" aria-label="Main navigation">
          {navigation.map((item) => <button className={activeSection === item.id ? "is-active" : ""} key={item.id} onClick={() => setActiveSection(item.id)}><MainIcon name={item.icon} />{item.label}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <button className="overlay-launcher" onClick={() => window.timesheetDesktop?.showOverlayWindow?.()}><MainIcon name="overlay" />Show overlay</button>
          <div className="profile-row"><span>PR</span><p>Prithiv Raj</p><MainIcon name="chevron" /></div>
        </div>
      </aside>

      <section className="dashboard-page">
        <header className="dashboard-header">
          <div><h1>{activeSection === "home" ? `${greeting}, Prithiv.` : navigation.find((item) => item.id === activeSection)?.label}</h1><p>{activeSection === "home" ? "Stay focused. Make steady progress." : "Everything stays local to this device."}</p></div>
          {headerAction}
        </header>

        {error ? <p className="dashboard-error" role="alert">{error}</p> : null}

        {activeSection === "home" ? <>
          <form className="quick-capture" onSubmit={handleQuickCapture}><span><MainIcon name="pen" /></span><input value={quickCapture} onChange={(event) => setQuickCapture(event.target.value)} placeholder="Capture a task or note..." /><button aria-label="Create task" type="submit"><MainIcon name="plus" /></button></form>
          {activeTimer ? <section className="active-timer-banner"><div><span className="timer-pulse" />Tracking <strong>{activeTask?.title ?? "Task"}</strong><small>{formatDuration(elapsed)}</small></div><input value={timerNote} onBlur={handleSaveTimerNote} onChange={(event) => setTimerNote(event.target.value)} placeholder="Add a timer note..." /><button onClick={handleStopTimer}>Stop timer</button></section> : null}
          <section className="projects-section"><div className="section-title"><h2>Your Tasks</h2><span>{tasks.length} active</span></div><div className="project-cards" aria-live="polite">
            {loading ? <p className="empty-state">Loading your tasks...</p> : null}
            {!loading && tasks.length === 0 ? <p className="empty-state">Create your first task to start tracking time.</p> : null}
            {tasks.map((task, index) => { const activity = taskActivity.get(task.id) ?? { durationSeconds: 0, entryCount: 0, noteCount: 0 }; return <article className="project-card" key={task.id}>
              <span className={`project-icon tone-${index % 5}`}><MainIcon name={projectIcon(index)} /></span><div className="project-copy"><h3>{task.title}</h3><p>{formatDuration(activity.durationSeconds)} today <i>•</i> {activity.noteCount} {activity.noteCount === 1 ? "note" : "notes"}</p><small>{task.projectIds.length ? task.projectIds.map((id) => projectById.get(id)?.title).filter(Boolean).join(" · ") : task.defaultNote ? `Latest note: ${task.defaultNote}` : activity.entryCount ? `${activity.entryCount} tracked entries` : "No project assigned"}</small></div>
              {activeTimer?.taskId === task.id ? <button className="card-timer-button is-running" onClick={handleStopTimer}>Stop</button> : <button aria-label={`Start ${task.title}`} className="card-timer-button" disabled={Boolean(activeTimer)} onClick={() => handleStartTask(task.id)}><MainIcon name="play" /></button>}
              <button className="archive-task-button" disabled={activeTimer?.taskId === task.id} onClick={() => handleArchiveTask(task)}>Archive</button>
            </article>; })}
          </div></section>
          <footer className="dashboard-footer"><MainIcon name="note" />Notes live with your tasks.</footer>
        </> : null}

        {activeSection === "entries" ? <section className="dashboard-panel"><div className="section-title"><h2>Recent entries</h2><span>{recentEntries.length} entries</span></div>{aiError ? <p className="ai-note-error" role="alert">{aiError}</p> : null}<div className="dashboard-entry-list">
          {recentEntries.length === 0 ? <p className="empty-state">No completed time entries yet.</p> : recentEntries.map((entry) => <article className={aiPreview?.entryId === entry.id ? "has-ai-preview" : ""} key={entry.id}><div><strong>{taskById.get(entry.taskId)?.title ?? "Archived task"}</strong><p>{formatEntryDateTime(entry.startedAt)} — {formatEntryDateTime(entry.endedAt)}</p>{entry.note ? <small>{entry.note}</small> : null}{renderAiPreview(entry)}</div><span>{formatDuration(entry.durationSeconds)}</span>{renderImproveNoteButton(entry)}<button onClick={() => handleEditEntry(entry)}>Edit</button><button className="delete-entry" onClick={() => handleDeleteEntry(entry)}>Delete</button></article>)}
        </div></section> : null}

        {activeSection === "tasks" ? <section className="dashboard-panel"><div className="section-title"><h2>All tasks</h2><button className="text-action" onClick={() => setIsTaskComposerOpen(true)}>Create task</button></div><div className="project-management-list">
          {tasks.length === 0 ? <p className="empty-state">No active tasks.</p> : null}
          {tasks.map((task) => <article key={task.id}><div><strong>{task.title}</strong><p>{task.projectIds.length ? task.projectIds.map((id) => projectById.get(id)?.title).filter(Boolean).join(" · ") : "No project"}{task.tags.length ? ` · ${task.tags.join(", ")}` : ""}</p></div><span>{formatDuration(taskActivity.get(task.id)?.durationSeconds ?? 0)} today</span><button disabled={activeTimer?.taskId === task.id} onClick={() => handleArchiveTask(task)}>Archive</button></article>)}
          {archivedTasks.length ? <div className="archived-list-heading">Archived tasks</div> : null}
          {archivedTasks.map((task) => <article className="is-archived" key={task.id}><div><strong>{task.title}</strong><p>{task.projectIds.length ? task.projectIds.map((id) => projectById.get(id)?.title).filter(Boolean).join(" · ") : "No project"}{task.tags.length ? ` · ${task.tags.join(", ")}` : ""}</p></div><span>{formatDuration(taskActivity.get(task.id)?.durationSeconds ?? 0)} total</span><button onClick={() => handleUnarchiveTask(task)}>Unarchive</button></article>)}
        </div></section> : null}

        {activeSection === "projects" ? <section className="dashboard-panel"><div className="section-title"><h2>Projects</h2><button className="text-action" onClick={() => setIsProjectComposerOpen(true)}>Create project</button></div><div className="project-management-list">
          {projects.length === 0 && archivedProjects.length === 0 ? <p className="empty-state">Create projects to organize related tasks.</p> : projects.map((project) => <article key={project.id}><div><strong>{project.title}</strong><p>{tasks.filter((task) => task.projectIds.includes(project.id)).length} active tasks</p></div><button onClick={() => handleRenameProject(project)}>Rename</button><button onClick={() => handleArchiveProject(project.id)}>Archive</button></article>)}
          {archivedProjects.length ? <div className="archived-list-heading">Archived projects</div> : null}
          {archivedProjects.map((project) => <article className="is-archived" key={project.id}><div><strong>{project.title}</strong><p>Archived project</p></div><button onClick={() => handleRenameProject(project)}>Rename</button><button onClick={() => handleUnarchiveProject(project.id)}>Unarchive</button></article>)}
        </div></section> : null}

        {activeSection === "notes" ? <section className="dashboard-panel"><div className="section-title"><h2>Task notes</h2><span>{noteEntries.length} saved</span></div>{aiError ? <p className="ai-note-error" role="alert">{aiError}</p> : null}<div className="notes-list">
          {noteEntries.length === 0 ? <p className="empty-state">Notes added while tracking will appear here.</p> : noteEntries.map((entry) => {
            return <article className={aiPreview?.entryId === entry.id ? "has-ai-preview" : ""} key={entry.id}><span><MainIcon name="note" /></span><div className="note-row-body"><div className="note-row-header"><div><strong>{taskById.get(entry.taskId)?.title ?? "Archived task"}</strong><p>{entry.note}</p><small>{formatEntryDateTime(entry.startedAt)}</small></div>{renderImproveNoteButton(entry)}</div>{renderAiPreview(entry)}</div></article>;
          })}
        </div></section> : null}

        {activeSection === "backup" ? <div className="settings-grid"><section className="dashboard-panel backup-panel"><p className="panel-kicker">Backup</p><h2>Keep a private copy</h2><p>Export JSON for a full restore, or CSV for a report. Importing JSON replaces the data stored on this device.</p><div className="backup-actions"><button className="new-project-button" onClick={handleExportJson}>Export JSON</button><button onClick={handleExportCsv}>Export CSV</button><label>Import JSON<input accept="application/json,.json" type="file" onChange={handleImportJson} /></label></div></section><section className="dashboard-panel ai-settings-panel"><p className="panel-kicker">Local AI</p><h2>Ollama sidecar</h2><p>Improve notes with a local Ollama model. Default: <code>{DEFAULT_OLLAMA_MODEL}</code>. Fallback: <code>{FALLBACK_OLLAMA_MODEL}</code>.</p><label className="ai-model-field">Model name<input value={ollamaModel} onChange={(event) => setOllamaModel(event.target.value)} onBlur={() => setOllamaModel((current) => current.trim() || DEFAULT_OLLAMA_MODEL)} placeholder={DEFAULT_OLLAMA_MODEL} /></label></section><section className="dashboard-panel theme-panel"><p className="panel-kicker">Theme lab</p><h2>{activeTheme.label}</h2><p>{activeTheme.description}</p><div className="theme-options" role="list" aria-label="Theme exploration options">{themeOptions.map((theme) => <button aria-pressed={theme.id === themeId} className={theme.id === themeId ? "is-active" : ""} key={theme.id} onClick={() => setThemeId(theme.id)} type="button"><span className="theme-swatch-row">{theme.swatches.map((swatch) => <i key={swatch} style={{ background: swatch }} />)}</span><strong>{theme.label}</strong><small>{theme.description}</small></button>)}</div></section><section className="dashboard-panel"><p className="panel-kicker">Review</p><h2>Tracked time</h2><div className="totals-list"><p><span>All entries</span><strong>{formatDuration(totalDuration(allEntries))}</strong></p>{dailySummaries.slice(0, 5).map((summary) => <p key={summary.date}><span>{summary.date}</span><strong>{formatDuration(summary.durationSeconds)}</strong></p>)}</div></section><section className="dashboard-panel"><p className="panel-kicker">Overlay</p><h2>Focus mode</h2><p>The overlay opens when this window is minimized, or when you choose Show overlay in the sidebar. Shortcut: Cmd/Ctrl+Shift+T.</p><button onClick={() => window.timesheetDesktop?.showOverlayWindow?.()}>Show overlay now</button></section></div> : null}
      </section>

      {isTaskComposerOpen ? <div className="dashboard-modal-backdrop" onMouseDown={() => setIsTaskComposerOpen(false)} role="presentation"><section className="project-composer" aria-modal="true" role="dialog" aria-labelledby="new-task-heading" onMouseDown={(event) => event.stopPropagation()}><button aria-label="Close new task" className="modal-close" onClick={() => setIsTaskComposerOpen(false)}>×</button><p className="panel-kicker">New task</p><h2 id="new-task-heading">What needs your attention?</h2><form onSubmit={handleCreateTask}><label>Task name<input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Data Pipeline Optimization" /></label><label>Projects <span className="project-options">{projects.length ? projects.map((project) => <label key={project.id}><input checked={taskProjectIds.includes(project.id)} type="checkbox" onChange={(event) => setTaskProjectIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} />{project.title}</label>) : <small className="field-hint">No projects yet. You can add one from Projects.</small>}</span><small className="field-hint">Optional — choose one or more projects.</small></label><label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="development, research" /></label><label>Starting note<textarea value={defaultNote} onChange={(event) => setDefaultNote(event.target.value)} placeholder="Optional context for this task" /></label><button className="new-project-button" type="submit"><MainIcon name="plus" />Create task</button></form></section></div> : null}

      {isProjectComposerOpen ? <div className="dashboard-modal-backdrop" onMouseDown={() => setIsProjectComposerOpen(false)} role="presentation"><section className="project-composer" aria-modal="true" role="dialog" aria-labelledby="new-project-heading" onMouseDown={(event) => event.stopPropagation()}><button aria-label="Close new project" className="modal-close" onClick={() => setIsProjectComposerOpen(false)}>×</button><p className="panel-kicker">New project</p><h2 id="new-project-heading">Organize related tasks.</h2><form onSubmit={handleCreateProject}><label>Project name<input autoFocus required value={newProjectTitle} onChange={(event) => setNewProjectTitle(event.target.value)} placeholder="Client work" /></label><button className="new-project-button" type="submit"><MainIcon name="plus" />Create project</button></form></section></div> : null}

      {isEntryComposerOpen ? <div className="dashboard-modal-backdrop" role="presentation" onMouseDown={handleCloseEntryEditor}><section aria-labelledby="entry-editor-title" aria-modal="true" className="project-composer entry-composer" role="dialog" onMouseDown={(event) => event.stopPropagation()}><button aria-label="Close entry editor" className="modal-close" onClick={handleCloseEntryEditor}>×</button><p className="panel-kicker">{editingEntry ? "Edit entry" : "New entry"}</p><h2 id="entry-editor-title">{editingEntry ? "Correct tracked time." : "Log completed work."}</h2><form onSubmit={handleSaveEntry}><label>Task<select required value={entryTaskId} onChange={(event) => setEntryTaskId(event.target.value)}>{(editingEntry ? allTasks : tasks).map((task) => <option key={task.id} value={task.id}>{task.title}{task.archived ? " (archived)" : ""}</option>)}</select></label><div className="composer-row"><label>Start<input required type="datetime-local" value={entryStartedAt} onChange={(event) => setEntryStartedAt(event.target.value)} /></label><label>End<input required type="datetime-local" value={entryEndedAt} onChange={(event) => setEntryEndedAt(event.target.value)} /></label></div><label>Note<textarea value={entryNote} onChange={(event) => setEntryNote(event.target.value)} /></label><div className="composer-actions"><button className="new-project-button" type="submit">{editingEntry ? "Save changes" : "Create entry"}</button><button type="button" onClick={handleCloseEntryEditor}>Cancel</button></div></form></section></div> : null}
    </main>
  );
}

type MainIconName = "chevron" | "clock" | "home" | "list" | "more" | "note" | "overlay" | "pen" | "play" | "plus" | "settings" | "timer" | "briefcase" | "chart" | "phone" | "shield" | "document";

function projectIcon(index: number): MainIconName {
  return ["briefcase", "chart", "phone", "shield", "document"][index % 5] as MainIconName;
}

function MainIcon({ name }: { name: MainIconName }) {
  const paths: Record<MainIconName, ReactNode> = {
    chevron: <path d="m8 10 4 4 4-4" />,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    home: <><path d="m4 11 8-7 8 7v9H4z" /><path d="M9 20v-6h6v6" /></>,
    list: <><path d="M9 6h10M9 12h10M9 18h10" /><circle cx="4" cy="6" r=".8" fill="currentColor" /><circle cx="4" cy="12" r=".8" fill="currentColor" /><circle cx="4" cy="18" r=".8" fill="currentColor" /></>,
    more: <><circle cx="12" cy="5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="19" r="1.2" fill="currentColor" /></>,
    note: <><path d="M6 3h9l3 3v15H6zM15 3v4h4M9 12h6M9 16h6" /></>,
    overlay: <><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M8 9h8M8 13h5" /></>,
    pen: <><path d="m5 19 3.5-.8L19 7.7 16.3 5 5.8 15.5zM14.8 6.5l2.7 2.7" /></>,
    play: <path d="m9 6 8 6-8 6z" fill="currentColor" stroke="none" />,
    plus: <path d="M12 5v14M5 12h14" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7.5 7.5 0 0 0-.1-1l2-1.5-2-3.5-2.3.9a7 7 0 0 0-1.7-1L14.5 3h-5L9 5.9a7 7 0 0 0-1.7 1L5 6 3 9.5 5 11a7.5 7.5 0 0 0 0 2l-2 1.5L5 18l2.3-.9a7 7 0 0 0 1.7 1l.5 2.9h5l.4-2.9a7 7 0 0 0 1.7-1l2.3.9 2-3.5-2-1.5c.1-.3.1-.7.1-1Z" /></>,
    timer: <><rect x="4" y="4" width="16" height="16" rx="5" /><path d="M12 8v4l2.5 2.5M9 2h6" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M8 7V5h8v2M3 12h18M10 12v2h4v-2" /></>,
    chart: <><path d="M5 20V11h4v9M10 20V5h4v15M15 20v-8h4v8M3 20h18" /></>,
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
