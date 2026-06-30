import { type FormEvent, type ReactNode, useMemo, useState } from "react";
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
      const status = await window.reamDesktop?.getOllamaStatus?.();
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
      await window.reamDesktop?.openOllamaDownload?.();
    } catch (downloadError) {
      setAiStatus(downloadError instanceof Error ? downloadError.message : "Unable to open Ollama download.");
    }
  }

  async function handlePullOllamaModel() {
    setAiBusy(true);
    setAiStatus(`Installing ${ollamaModel}...`);
    try {
      const result = await window.reamDesktop?.pullOllamaModel?.(ollamaModel);
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
      <form className="setup-window" onSubmit={handleSubmit}>
        <aside className="setup-rail">
          <span className="setup-mark"><img alt="Ream" src={reamIcon} /></span>
          <div className="setup-rail-copy">
            <h2>Let's set things up</h2>
            <p>Personalize your workspace so it feels just right.</p>
          </div>
          <ol className="setup-steps" aria-label="Setup progress">
            <li className="is-active"><b>1</b><span><strong>Profile</strong><small>Your name & identity</small></span></li>
            <li><b>2</b><span><strong>Theme</strong><small>Choose your vibe</small></span></li>
            <li><b>3</b><span><strong>Workspace</strong><small>Your starter setup</small></span></li>
            <li><b>4</b><span><strong>Experience</strong><small>AI & preferences</small></span></li>
            <li><b>5</b><span><strong>Finish</strong><small>You're all set</small></span></li>
          </ol>
          <div className="setup-rail-scene" aria-hidden="true"><span /><i /></div>
        </aside>

        <section className="setup-main">
          <header className="setup-hero">
            <h1>Welcome! 👋</h1>
            <p>Let's personalize your workspace in a few quick steps.</p>
          </header>

          {error ? <p className="setup-error" role="alert">{error}</p> : null}

          <section className="setup-grid">
            <label className="setup-card setup-name-card">
              <CardTitle icon="user" title="Your name" subtitle="This is how you'll appear in the app." />
              <span className="setup-input-shell"><SetupIcon name="user" /><input autoFocus required value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="Prithiv Raj" /></span>
            </label>

            <section className="setup-card setup-theme-card">
              <CardTitle icon="palette" title="Theme" subtitle="Pick a theme that inspires you." />
            <div className="setup-theme-list">
              {themeOptions.map((theme) => <button aria-pressed={theme.id === themeId} className={theme.id === themeId ? "is-active" : ""} key={theme.id} onClick={() => selectTheme(theme.id)} type="button"><span className="theme-swatch-row">{theme.swatches.map((swatch) => <i key={swatch} style={{ background: swatch }} />)}</span><strong>{theme.label}</strong>{theme.id === themeId ? <i className="setup-checkmark"><SetupIcon name="check" /></i> : null}</button>)}
            </div>
            <small>{activeTheme.description}</small>
          </section>

          <section className="setup-card setup-transparency-card">
            <CardTitle icon="layers" title="Overlay" subtitle="Control how subtle the always-on overlay feels." />
            <label className="setup-slider-field">Transparency <strong>{formatTransparency(overlayTransparency)}</strong><input aria-label="Overlay transparency" max="100" min="50" onChange={(event) => setOverlayTransparency(Number(event.target.value) / 100)} type="range" value={Math.round(overlayTransparency * 100)} /></label>
            <div className="setup-slider-scale"><span>Subtle</span><span>Solid</span></div>
          </section>

          <section className="setup-card setup-list-card">
            <CardTitle icon="briefcase" title="Starter workspace" subtitle="Add some starter tasks or projects to get going." />
            <div className="setup-chip-row">
              {STARTER_TASKS.map((task) => <button key={task} onClick={() => addTask(task)} type="button">+ {task}</button>)}
              {STARTER_PROJECTS.map((project) => <button key={project} onClick={() => addProject(project)} type="button">+ {project}</button>)}
            </div>
            <div className="setup-inline-add">
              <span><SetupIcon name="task" /><input value={taskInput} onChange={(event) => setTaskInput(event.target.value)} placeholder="Add a task" /></span>
              <button type="button" onClick={() => addTask()}>Add</button>
            </div>
            <div className="setup-inline-add">
              <span><SetupIcon name="folder" /><input value={projectInput} onChange={(event) => setProjectInput(event.target.value)} placeholder="Add a project" /></span>
              <button type="button" onClick={() => addProject()}>Add</button>
            </div>
            <SelectedItems items={[...starterProjects.map((project) => `Project: ${project}`), ...starterTasks.map((task) => `Task: ${task}`)]} />
          </section>

          <section className="setup-card setup-ai-card">
            <div className="setup-ai-heading"><CardTitle icon="sparkles" title="Local AI" subtitle="Choose your local model for AI features." /><label className="setup-toggle"><input checked={aiEnabled} onChange={(event) => setAiEnabled(event.target.checked)} type="checkbox" /><span>Enable note improvement setup</span></label></div>
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
        </section>

        <footer className="setup-actions">
          <button className="setup-link-button" onClick={() => { setStarterTasks([]); setStarterProjects([]); setAiEnabled(false); }} type="button">Skip all</button>
          <div><button className="setup-secondary-button" disabled type="button">Back</button><button className="new-project-button" disabled={saving} type="submit">{saving ? "Starting..." : "Next"}<SetupIcon name="arrow" /></button></div>
        </footer>
      </form>
    </main>
  );
}

function CardTitle({ icon, title, subtitle }: { icon: SetupIconName; title: string; subtitle: string }) {
  return <div className="setup-card-title"><span><SetupIcon name={icon} /></span><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function SelectedItems({ items }: { items: string[] }) {
  if (!items.length) {
    return <div className="setup-empty-state"><span className="setup-empty-plant" /><strong>No starter tasks or projects yet.</strong><small>Add some above to see them here.</small></div>;
  }

  return <div className="setup-selected-list">{items.map((item) => <span key={item}>{item}</span>)}</div>;
}

function formatTransparency(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type SetupIconName = "arrow" | "briefcase" | "check" | "folder" | "layers" | "palette" | "sparkles" | "task" | "user";

function SetupIcon({ name }: { name: SetupIconName }) {
  const paths: Record<SetupIconName, ReactNode> = {
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    briefcase: <><path d="M9 7V5h6v2" /><rect x="4" y="7" width="16" height="12" rx="2" /><path d="M9 12h6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    folder: <path d="M4 7h6l2 2h8v10H4z" />,
    layers: <><path d="m12 4 8 4-8 4-8-4Z" /><path d="m4 12 8 4 8-4M4 16l8 4 8-4" /></>,
    palette: <><path d="M12 4a8 8 0 0 0-2 15c.8.2 1.4-.5 1.4-1.2 0-.6.5-1.1 1.1-1.1H14a6 6 0 0 0 6-6c0-3.7-3.4-6.7-8-6.7Z" /><path d="M7.5 11.5h.1M9.5 8.5h.1M13 7.5h.1M16 10h.1" /></>,
    sparkles: <><path d="M12 3 14 8l5 2-5 2-2 5-2-5-5-2 5-2Z" /><path d="M5 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1Z" /></>,
    task: <><rect x="5" y="5" width="14" height="14" rx="2" /><path d="m8 12 2 2 5-5" /></>,
    user: <><circle cx="12" cy="8" r="3" /><path d="M6 20a6 6 0 0 1 12 0" /></>
  };

  return <svg className="setup-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" aria-hidden="true">{paths[name]}</svg>;
}
