import { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen, shell } from "electron";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  DEFAULT_OLLAMA_MODEL,
  FALLBACK_OLLAMA_MODEL,
  type ImproveNoteRequest,
  type ImproveNoteResult,
  type OllamaHealthStatus,
  type OllamaPullResult,
  validateImprovedNoteOutput
} from "../shared/ai";
import { startAiSidecar, type AiSidecarHandle } from "./aiSidecar";
import {
  calculateExpandedOverlayBounds as calculateExpandedOverlayBoundsForWorkArea,
  getTopRightOverlayBounds as getTopRightOverlayBoundsForWorkArea,
  type OverlayBounds,
  OVERLAY_COMPACT_SIZE,
  OVERLAY_EXPANDED_SIZE
} from "../shared/overlayBounds";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const STABLE_USER_DATA_DIR = "ream";
const LEGACY_USER_DATA_DIR = "timesheet-tracker";
const DATA_LOCATION_CONFIG_FILE = "ream-data-location.json";
const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

const defaultUserDataPath = join(app.getPath("appData"), STABLE_USER_DATA_DIR);
const userDataPath = readConfiguredUserDataPath() ?? defaultUserDataPath;
migrateLegacyUserData(userDataPath);
app.setPath("userData", userDataPath);

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let aiSidecar: AiSidecarHandle | null = null;

let overlayAnchorBounds: OverlayBounds | null = null;
let overlayExpanded = false;
let suppressMainBlurOverlay = false;

interface DataLocationInfo {
  path: string;
  isCustom: boolean;
  defaultPath: string;
}

interface DataLocationConfig {
  userDataPath?: string;
}

function getDataLocationConfigPath(): string {
  return join(app.getPath("appData"), DATA_LOCATION_CONFIG_FILE);
}

function readConfiguredUserDataPath(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(getDataLocationConfigPath(), "utf8")) as DataLocationConfig;
    const configuredPath = parsed.userDataPath?.trim();
    if (configuredPath && isAbsolute(configuredPath)) {
      return configuredPath;
    }
  } catch {
    // Missing or invalid config just means Ream uses its default data location.
  }

  return null;
}

function writeConfiguredUserDataPath(nextUserDataPath: string): void {
  mkdirSync(dirname(getDataLocationConfigPath()), { recursive: true });
  writeFileSync(getDataLocationConfigPath(), `${JSON.stringify({ userDataPath: nextUserDataPath }, null, 2)}\n`);
}

function getDataLocationInfo(): DataLocationInfo {
  return {
    path: app.getPath("userData"),
    isCustom: resolve(app.getPath("userData")) !== resolve(defaultUserDataPath),
    defaultPath: defaultUserDataPath
  };
}

function isInsidePath(parentPath: string, childPath: string): boolean {
  const parent = resolve(parentPath);
  const child = resolve(childPath);
  return child === parent || child.startsWith(`${parent}${sep}`);
}

function copyCurrentUserDataTo(nextUserDataPath: string): void {
  const currentUserDataPath = app.getPath("userData");
  if (resolve(currentUserDataPath) === resolve(nextUserDataPath)) {
    return;
  }

  if (isInsidePath(currentUserDataPath, nextUserDataPath)) {
    throw new Error("Choose a folder outside the current Ream data folder.");
  }

  mkdirSync(nextUserDataPath, { recursive: true });
  cpSync(currentUserDataPath, nextUserDataPath, {
    recursive: true,
    force: false,
    errorOnExist: false,
    verbatimSymlinks: true
  });
}

async function chooseDataLocation(): Promise<DataLocationInfo | null> {
  const options: Electron.OpenDialogOptions = {
    title: "Choose Ream data folder",
    buttonLabel: "Use Folder",
    properties: ["openDirectory", "createDirectory"]
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const nextUserDataPath = resolve(result.filePaths[0]);
  copyCurrentUserDataTo(nextUserDataPath);
  writeConfiguredUserDataPath(nextUserDataPath);
  app.relaunch();
  app.exit(0);
  return { path: nextUserDataPath, isCustom: true, defaultPath: defaultUserDataPath };
}

function migrateLegacyUserData(nextUserDataPath: string) {
  const legacyUserDataPath = join(app.getPath("appData"), LEGACY_USER_DATA_DIR);
  if (existsSync(nextUserDataPath) || !existsSync(legacyUserDataPath)) {
    return;
  }

  try {
    mkdirSync(dirname(nextUserDataPath), { recursive: true });
    cpSync(legacyUserDataPath, nextUserDataPath, { recursive: true });
  } catch (error) {
    console.warn("Unable to migrate legacy Ream user data.", error);
  }
}

function rendererUrl(route = "/"): string {
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.hash = route;
    return url.toString();
  }

  return `file://${join(__dirname, "../renderer/index.html")}#${route}`;
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1040,
    minHeight: 700,
    title: "Ream",
    backgroundColor: "#f7f8fb",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.loadURL(rendererUrl("/"));
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  window.on("closed", () => {
    mainWindow = null;
  });

  // The main workspace is the only window shown at launch. The compact timer
  // appears whenever the user leaves it, either by minimizing or switching apps.
  window.on("minimize", () => {
    showOverlayWindow();
  });
  window.on("blur", () => {
    if (!suppressMainBlurOverlay && window.isVisible() && !window.isMinimized()) {
      showOverlayWindow();
    }
  });

  return window;
}

function applyOverlayPinned(window: BrowserWindow, pinned = true) {
  if (!pinned) {
    window.setAlwaysOnTop(false);
    return;
  }

  const level = process.platform === "darwin" ? "floating" : "screen-saver";
  window.setAlwaysOnTop(true, level);
  window.moveTop();
}

function getTopRightOverlayBounds(): OverlayBounds {
  return getTopRightOverlayBoundsForWorkArea(screen.getPrimaryDisplay().workArea);
}

function calculateExpandedOverlayBounds(anchor: OverlayBounds): OverlayBounds {
  return calculateExpandedOverlayBoundsForWorkArea(anchor, screen.getDisplayMatching(anchor).workArea);
}

function setOverlayMousePassthrough(window: BrowserWindow, passthrough: boolean) {
  window.setIgnoreMouseEvents(passthrough, { forward: true });
}

function applyOverlayBounds(window: BrowserWindow, bounds: OverlayBounds) {
  window.setBounds(bounds, false);
  applyOverlayPinned(window, true);
}

function createOverlayWindow(): BrowserWindow {
  const initialBounds = getTopRightOverlayBounds();
  overlayAnchorBounds = initialBounds;
  overlayExpanded = false;
  const window = new BrowserWindow({
    ...initialBounds,
    minWidth: initialBounds.width,
    minHeight: initialBounds.height,
    maxWidth: OVERLAY_EXPANDED_SIZE.width,
    maxHeight: OVERLAY_EXPANDED_SIZE.height,
    title: "Ream Overlay",
    frame: false,
    show: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyOverlayPinned(window, true);
  setOverlayMousePassthrough(window, false);
  window.loadURL(rendererUrl("/overlay"));

  window.on("show", () => applyOverlayPinned(window, true));
  window.on("focus", () => applyOverlayPinned(window, true));
  window.on("blur", () => applyOverlayPinned(window, true));

  window.on("closed", () => {
    overlayWindow = null;
  });

  return window;
}

function ensureMainWindow(): BrowserWindow {
  if (!mainWindow) {
    mainWindow = createMainWindow();
  }
  return mainWindow;
}

function ensureOverlayWindow(): BrowserWindow {
  if (!overlayWindow) {
    overlayWindow = createOverlayWindow();
  }
  return overlayWindow;
}

function runWithSuppressedMainBlur(action: () => void) {
  suppressMainBlurOverlay = true;
  action();
  setTimeout(() => {
    suppressMainBlurOverlay = false;
  }, 0);
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
    return;
  }

  runWithSuppressedMainBlur(() => {
    mainWindow?.hide();
  });
}

function destroyOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = null;
    overlayExpanded = false;
    return;
  }

  overlayExpanded = false;
  overlayWindow.destroy();
}

function showMainWindow() {
  destroyOverlayWindow();
  const window = ensureMainWindow();
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

function resizeOverlayWindow(window: BrowserWindow, expanded: boolean) {
  if (expanded) {
    overlayAnchorBounds = window.getBounds();
    applyOverlayBounds(window, calculateExpandedOverlayBounds(overlayAnchorBounds));
    setOverlayMousePassthrough(window, false);
    window.focus();
    window.webContents.focus();
    return;
  }

  const anchor = overlayAnchorBounds ?? window.getBounds();
  applyOverlayBounds(window, {
    x: anchor.x,
    y: anchor.y,
    width: OVERLAY_COMPACT_SIZE.width,
    height: OVERLAY_COMPACT_SIZE.height
  });
  setOverlayMousePassthrough(window, false);
}

function setOverlayExpanded(expanded: boolean) {
  if (overlayExpanded === expanded) {
    return;
  }

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayExpanded = false;
    overlayWindow = null;
    return;
  }

  overlayExpanded = expanded;
  resizeOverlayWindow(overlayWindow, expanded);
  overlayWindow.webContents.send("overlay:expanded-changed", expanded);
}

function showOverlayWindow() {
  hideMainWindow();
  const window = ensureOverlayWindow();
  setOverlayMousePassthrough(window, false);
  window.show();
  applyOverlayPinned(window, true);
  window.focus();
}

function closeOverlayAndShowMainWindow() {
  showMainWindow();
}

function toggleOverlayWindow() {
  const window = ensureOverlayWindow();
  if (window.isVisible()) {
    showMainWindow();
    return;
  }
  showOverlayWindow();
}

function createTrayIcon() {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "ream-icon.png")
    : join(__dirname, "../../build/icons/ream-icon.png");
  return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
}

function buildAppMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "quit" as const }
            ]
          }
        ]
      : []),
    {
      label: "Ream",
      submenu: [
        { label: "Show Main Window", click: showMainWindow },
        { label: "Toggle Overlay", accelerator: "CommandOrControl+Shift+T", click: toggleOverlayWindow },
        { label: "Show Overlay", click: showOverlayWindow },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Ream — task time tracker");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Main Window", click: showMainWindow },
      { label: "Toggle Overlay", click: toggleOverlayWindow },
      { label: "Show Overlay", click: showOverlayWindow },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() }
    ])
  );
  tray.on("click", toggleOverlayWindow);
}

function registerShortcuts() {
  globalShortcut.register("CommandOrControl+Shift+T", toggleOverlayWindow);
}

async function readOllamaStatus(): Promise<OllamaHealthStatus> {
  if (!aiSidecar) {
    return {
      ok: false,
      ollama: { ok: false },
      model: DEFAULT_OLLAMA_MODEL,
      fallbackModel: FALLBACK_OLLAMA_MODEL
    };
  }

  const response = await fetch(`${aiSidecar.url}/ai/health`);
  const payload = await response.json() as unknown;
  return normalizeOllamaHealthStatus(payload);
}

async function pullOllamaModel(model: string): Promise<OllamaPullResult> {
  const normalizedModel = normalizeOllamaModelName(model);
  return new Promise((resolve, reject) => {
    execFile("ollama", ["pull", normalizedModel], { timeout: 600_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const message = error.message.includes("ENOENT")
          ? "Ollama CLI is not installed or is not on PATH."
          : stderr.trim() || error.message;
        reject(new Error(message));
        return;
      }

      resolve({ model: normalizedModel, output: [stdout, stderr].map((value) => value.trim()).filter(Boolean).join("\n") });
    });
  });
}

function normalizeOllamaModelName(value: string): string {
  const model = value.trim();
  if (!model) {
    throw new Error("Choose an Ollama model first.");
  }

  if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
    throw new Error("Ollama model names can only include letters, numbers, dots, underscores, colons, and hyphens.");
  }

  return model;
}

function normalizeOllamaHealthStatus(value: unknown): OllamaHealthStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ollama status response was invalid.");
  }

  const payload = value as Record<string, unknown>;
  const ollama = payload.ollama && typeof payload.ollama === "object" && !Array.isArray(payload.ollama)
    ? payload.ollama as Record<string, unknown>
    : {};
  return {
    ok: payload.ok === true,
    ollama: { ok: ollama.ok === true },
    model: typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : DEFAULT_OLLAMA_MODEL,
    fallbackModel: typeof payload.fallbackModel === "string" && payload.fallbackModel.trim() ? payload.fallbackModel.trim() : FALLBACK_OLLAMA_MODEL
  };
}

app.whenReady().then(() => {
  ensureMainWindow();
  buildAppMenu();
  setupTray();
  registerShortcuts();
  startAiSidecar()
    .then((handle) => {
      aiSidecar = handle;
    })
    .catch((error: unknown) => {
      console.warn("AI sidecar failed to start.", error);
    });

  ipcMain.handle("window:show-main", () => {
    showMainWindow();
  });

  ipcMain.handle("window:set-overlay-pinned", (_event, pinned: boolean) => {
    const window = ensureOverlayWindow();
    applyOverlayPinned(window, pinned);
    return window.isAlwaysOnTop();
  });

  ipcMain.handle("window:show-overlay", () => {
    showOverlayWindow();
  });

  ipcMain.handle("window:set-overlay-expanded", (_event, expanded: boolean) => {
    setOverlayExpanded(expanded);
  });

  ipcMain.handle("window:set-overlay-interactive", (_event, interactive: boolean) => {
    const window = ensureOverlayWindow();
    setOverlayMousePassthrough(window, !interactive);
  });

  ipcMain.handle("window:toggle-overlay", () => {
    toggleOverlayWindow();
  });

  ipcMain.handle("window:minimize-overlay", () => {
    overlayWindow?.minimize();
  });

  ipcMain.handle("window:close-overlay", () => {
    closeOverlayAndShowMainWindow();
  });

  ipcMain.handle("data:get-location", () => getDataLocationInfo());

  ipcMain.handle("data:choose-location", () => chooseDataLocation());

  ipcMain.handle("ai:improve-note", async (_event, input: ImproveNoteRequest): Promise<ImproveNoteResult> => {
    if (!aiSidecar) {
      throw new Error("AI sidecar is not available. Restart Ream and try again.");
    }

    const model = input.model?.trim() || DEFAULT_OLLAMA_MODEL;
    const response = await fetch(`${aiSidecar.url}/ai/improve-note`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, model })
    });
    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Unable to improve note with AI.";
      throw new Error(message);
    }

    return {
      model: response.headers.get("x-ream-ai-model")?.trim() || model,
      output: validateImprovedNoteOutput(payload)
    };
  });

  ipcMain.handle("ai:ollama-status", () => readOllamaStatus());

  ipcMain.handle("ai:open-ollama-download", async () => {
    await shell.openExternal(OLLAMA_DOWNLOAD_URL);
  });

  ipcMain.handle("ai:pull-ollama-model", (_event, model: string) => pullOllamaModel(model));

  app.on("activate", () => {
    ensureMainWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  void aiSidecar?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
