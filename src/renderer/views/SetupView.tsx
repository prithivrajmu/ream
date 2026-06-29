import { type FormEvent, useMemo, useState } from "react";
import { DEFAULT_OLLAMA_MODEL, FALLBACK_OLLAMA_MODEL, OLLAMA_MODEL_STORAGE_KEY } from "../../shared/ai";
import { createProject, listActiveProjects } from "../../shared/projectRepository";
import { createTask, listActiveTasks } from "../../shared/taskRepository";
import { db } from "../../shared/db";
import { completeAppSettings, type AppSettings } from "../appSettings";
import { themeOptions, type ThemeId } from "../themeOptions";
import reamIcon from "../assets/ream-icon.png";

interface SetupViewProps {
  initialSettings: AppSettings;
  onComplete: (settings: AppSettings) => void;
  onThemeChange: (themeId: ThemeId) => void;
}

const STARTER_TASKS = ["Plan today", "Deep work", "Admin follow-up"];
const STARTER_PROJECTS = ["Client work", "Internal"];
const OLLAMA_MODELS = [DEFAULT_OLLAMA_MODEL, FALLBACK_OLLAMA_MODEL, "mistral:7b", "qwen2.5:3b"];

export function SetupView({ initialSettings, onComplete, onThemeChange }: SetupViewProps) {
  const [userName, setUserName] = useState(initialSettings.userName);
  const [themeId, setThemeId] = useState<ThemeId>(initialSettings.themeId);
  const [overlayTransparency, setOverlayTransparency] = useState(initialSettings.overlayTransparency);
  const [taskInput, setTaskInput] = useState("");
  const [projectInput, setProjectInput] = useState("");
  const [starterTasks, setStarterTasks] = useState<string[]>([]);
  const [starterProjects, setStarterProjects] = useState<string[]>([]);
  const [aiEnabled, setAiEnabled] = useState(initialSettings.aiSetupPreference === "enabled");
  const [ollamaModel, setOllamaModel] = useState(initialSettings.ollamaModel || DEFAULT_OLLAMA_MODEL);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const activeTheme = useMemo(() => themeOptions.find((theme) => theme.id === themeId) ?? themeOptions[0], [themeId]);
  const displayName = userName.trim();

  function selectTheme(nextThemeId: ThemeId) {
    setThemeId(nextThemeId);
    onThemeChange(nextThemeId);
  }

  function addTask(title = taskInput) {
    const normalized = title.trim();
    if (!normalized || starterTasks.some((task) => task.localeCompare(normalized, undefined, { sensitivity: "accent" }) === 0)) {
      setTaskInput("");
      return;
    }
    setStarterTasks((current) => [...current, normalized]);
    setTaskInput("");
  }

  function addProject(title = projectInput) {
    const normalized = title.trim();
    if (!normalized || starterProjects.some((project) => project.localeCompare(normalized, undefined, { sensitivity: "accent" }) === 0)) {
      setProjectInput("");
      return;
    }
    setStarterProjects((current) => [...current, normalized]);
    setProjectInput("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!displayName) {
      setError("Enter your name to finish setup.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const [existingProjects, existingTasks] = await Promise.all([listActiveProjects(db), listActiveTasks(db)]);
      const createdProjectIds: string[] = [];
      for (const projectTitle of starterProjects) {
        const existingProject = existingProjects.find((project) => project.title.localeCompare(projectTitle, undefined, { sensitivity: "accent" }) === 0);
        if (existingProject) {
          createdProjectIds.push(existingProject.id);
          continue;
        }
        const project = await createProject(db, { title: projectTitle });
        createdProjectIds.push(project.id);
      }

      for (const taskTitle of starterTasks) {
        if (existingTasks.some((task) => task.title.localeCompare(taskTitle, undefined, { sensitivity: "accent" }) === 0)) {
          continue;
        }
        await createTask(db, { title: taskTitle, projectIds: createdProjectIds.slice(0, 1) });
      }

      window.localStorage.setItem(OLLAMA_MODEL_STORAGE_KEY, aiEnabled ? ollamaModel.trim() || DEFAULT_OLLAMA_MODEL : DEFAULT_OLLAMA_MODEL);
      onComplete(completeAppSettings({
        ...initialSettings,
        userName: displayName,
        themeId,
        overlayTransparency,
        aiSetupPreference: aiEnabled ? "enabled" : "skipped",
        ollamaModel: aiEnabled ? ollamaModel.trim() || DEFAULT_OLLAMA_MODEL : DEFAULT_OLLAMA_MODEL
      }));
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Unable to finish setup.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCheckOllamaStatus() {
    setAiBusy(true);
    setAiStatus(null);
    try {
      const status = await window.timesheetDesktop?.getOllamaStatus?.();
      if (!status) {
        throw new Error("Ollama setup is only available in the desktop app.");
      }
      setAiStatus(status.ollama.ok ? `Ollama is running. Default model: ${status.model}.` : "Ollama is not running yet.");
    } catch (statusError) {
      setAiStatus(statusError instanceof Error ? statusError.message : "Unable to check Ollama.");
    } finally {
      setAiBusy(false);
    }
  }

  async function handleOpenOllamaDownload() {
    try {
      await window.timesheetDesktop?.openOllamaDownload?.();
    } catch (downloadError) {
      setAiStatus(downloadError instanceof Error ? downloadError.message : "Unable to open Ollama download.");
    }
  }

  async function handlePullOllamaModel() {
    setAiBusy(true);
    setAiStatus(`Installing ${ollamaModel}...`);
    try {
      const result = await window.timesheetDesktop?.pullOllamaModel?.(ollamaModel);
      if (!result) {
        throw new Error("Model install is only available in the desktop app.");
      }
      setAiStatus(result.output || `${result.model} is installed.`);
    } catch (pullError) {
      setAiStatus(pullError instanceof Error ? pullError.message : "Unable to install Ollama model.");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <main className={`setup-shell theme-${themeId}`}>
      <form className="setup-panel" onSubmit={handleSubmit}>
        <section className="setup-hero">
          <span className="setup-mark"><img alt="Ream" src={reamIcon} /></span>
          <div>
            <p className="panel-kicker">Welcome to Ream setup</p>
            <h1>{displayName ? `Set up Ream for ${displayName}.` : "Set up Ream in a minute."}</h1>
            <p>Choose a few defaults now. Everything except your name can be changed later.</p>
          </div>
        </section>

        {error ? <p className="setup-error" role="alert">{error}</p> : null}

        <section className="setup-grid">
          <label className="setup-card setup-name-card">
            <span>Name</span>
            <input autoFocus required value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="Prithiv Raj" />
          </label>

          <section className="setup-card setup-theme-card">
            <div className="setup-card-header"><span>Theme</span></div>
            <div className="setup-theme-list">
              {themeOptions.map((theme) => <button aria-pressed={theme.id === themeId} className={theme.id === themeId ? "is-active" : ""} key={theme.id} onClick={() => selectTheme(theme.id)} type="button"><span className="theme-swatch-row">{theme.swatches.map((swatch) => <i key={swatch} style={{ background: swatch }} />)}</span><strong>{theme.label}</strong></button>)}
            </div>
            <small>{activeTheme.description}</small>
          </section>

          <section className="setup-card setup-transparency-card">
            <div className="setup-card-header"><span>Overlay</span></div>
            <label className="setup-slider-field">Transparency <strong>{formatTransparency(overlayTransparency)}</strong><input aria-label="Overlay transparency" max="100" min="50" onChange={(event) => setOverlayTransparency(Number(event.target.value) / 100)} type="range" value={Math.round(overlayTransparency * 100)} /></label>
            <div className="setup-slider-scale"><span>Subtle</span><span>Solid</span></div>
          </section>

          <section className="setup-card setup-list-card">
            <div className="setup-card-header"><span>Starter workspace</span></div>
            <div className="setup-chip-row">
              {STARTER_TASKS.map((task) => <button key={task} onClick={() => addTask(task)} type="button">+ {task}</button>)}
              {STARTER_PROJECTS.map((project) => <button key={project} onClick={() => addProject(project)} type="button">+ {project}</button>)}
            </div>
            <div className="setup-inline-add">
              <input value={taskInput} onChange={(event) => setTaskInput(event.target.value)} placeholder="Add a task" />
              <button type="button" onClick={() => addTask()}>Add</button>
            </div>
            <div className="setup-inline-add">
              <input value={projectInput} onChange={(event) => setProjectInput(event.target.value)} placeholder="Add a project" />
              <button type="button" onClick={() => addProject()}>Add</button>
            </div>
            <SelectedItems items={[...starterProjects.map((project) => `Project: ${project}`), ...starterTasks.map((task) => `Task: ${task}`)]} />
          </section>

          <section className="setup-card setup-ai-card">
            <div className="setup-card-header"><span>Local AI</span></div>
            <label className="setup-toggle"><input checked={aiEnabled} onChange={(event) => setAiEnabled(event.target.checked)} type="checkbox" />Enable note improvement setup</label>
            <select disabled={!aiEnabled} value={ollamaModel} onChange={(event) => setOllamaModel(event.target.value)}>
              {OLLAMA_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
            <div className="setup-ai-actions">
              <button disabled={!aiEnabled || aiBusy} onClick={() => void handleCheckOllamaStatus()} type="button">Check</button>
              <button disabled={!aiEnabled} onClick={() => void handleOpenOllamaDownload()} type="button">Install Ollama</button>
              <button disabled={!aiEnabled || aiBusy} onClick={() => void handlePullOllamaModel()} type="button">Pull model</button>
            </div>
            {aiStatus ? <p className="setup-ai-status">{aiStatus}</p> : null}
            <small>Default: {DEFAULT_OLLAMA_MODEL}. Fallback: {FALLBACK_OLLAMA_MODEL}.</small>
          </section>
        </section>

        <footer className="setup-actions">
          <p>Ream will keep using the same local notes database.</p>
          <button className="new-project-button" disabled={saving} type="submit">{saving ? "Starting..." : "Start Ream"}</button>
        </footer>
      </form>
    </main>
  );
}

function SelectedItems({ items }: { items: string[] }) {
  if (!items.length) {
    return <small>No starter tasks or projects selected.</small>;
  }

  return <div className="setup-selected-list">{items.map((item) => <span key={item}>{item}</span>)}</div>;
}

function formatTransparency(value: number): string {
  return `${Math.round(value * 100)}%`;
}
