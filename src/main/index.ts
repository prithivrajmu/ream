import { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen, shell } from "electron";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  DEFAULT_OLLAMA_MODEL,
  FALLBACK_OLLAMA_MODEL,
  type GenerateRecapRequest,
  type GenerateRecapResult,
  type ImproveNoteRequest,
  type ImproveNoteResult,
  type OllamaHealthStatus,
  validateGeneratedRecapOutput,
  validateImprovedNoteOutput
} from "../shared/ai";
import { startAiSidecar, type AiSidecarHandle } from "./aiSidecar";
import {
  calculateExpandedOverlayBounds as calculateExpandedOverlayBoundsForWorkArea,
  getOverlaySize,
  getTopRightOverlayBounds as getTopRightOverlayBoundsForWorkArea,
  type OverlayBounds,
  type OverlayMode,
  OVERLAY_DEFAULT_SIZE,
  OVERLAY_EXPANDED_SIZE
} from "../shared/overlayBounds";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const STABLE_USER_DATA_DIR = "ream";
const LEGACY_USER_DATA_DIR = "timesheet-tracker";
const DATA_LOCATION_CONFIG_FILE = "ream-data-location.json";
const OVERLAY_STATE_CONFIG_FILE = "ream-overlay-state.json";
const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";
const OLLAMA_LIBRARY_URL = "https://ollama.com/library";

const defaultUserDataPath = join(app.getPath("appData"), STABLE_USER_DATA_DIR);
const userDataPath = readConfiguredUserDataPath() ?? defaultUserDataPath;
migrateLegacyUserData(userDataPath);
app.setPath("userData", userDataPath);

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let aiSidecar: AiSidecarHandle | null = null;

let overlayAnchorBounds: OverlayBounds | null = null;
let overlayMode: OverlayMode = "default";
let suppressMainBlurOverlay = false;
let suppressMainMinimizeOverlay = false;
let restoreMainFullScreenAfterOverlay = false;

interface DataLocationInfo {
  path: string;
  isCustom: boolean;
  defaultPath: string;
}

interface DataLocationConfig {
  userDataPath?: string;
}

interface PersistedOverlayState {
  position?: {
    x: number;
    y: number;
  };
}

type OverlayContextCommand = "mini" | "default" | "pause-resume" | "stop" | "settings";

interface OverlayContextMenuInput {
  timerState?: "idle" | "running" | "paused" | "stopped";
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

function getOverlayStateConfigPath(): string {
  return join(app.getPath("userData"), OVERLAY_STATE_CONFIG_FILE);
}

function readOverlayState(): PersistedOverlayState {
  try {
    const parsed = JSON.parse(readFileSync(getOverlayStateConfigPath(), "utf8")) as PersistedOverlayState;
    const position = parsed.position;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      return { position: { x: Math.round(position.x), y: Math.round(position.y) } };
    }
  } catch {
    // Missing or invalid overlay state just means Ream uses the default position.
  }

  return {};
}

function writeOverlayState(nextState: PersistedOverlayState): void {
  mkdirSync(dirname(getOverlayStateConfigPath()), { recursive: true });
  writeFileSync(getOverlayStateConfigPath(), `${JSON.stringify(nextState, null, 2)}\n`);
}

function persistOverlayPosition(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }

  const { x, y } = window.getBounds();
  writeOverlayState({ position: { x, y } });
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
    if (!suppressMainMinimizeOverlay) {
      void showOverlayWindow({ hideMain: false });
    }
  });
  window.on("blur", () => {
    if (!suppressMainBlurOverlay && window.isVisible() && !window.isMinimized()) {
      void showOverlayWindow();
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
  const bounds = getTopRightOverlayBoundsForWorkArea(screen.getPrimaryDisplay().workArea);
  const savedPosition = readOverlayState().position;
  if (!savedPosition) {
    return bounds;
  }

  return clampOverlayBoundsToWorkArea({
    ...bounds,
    x: savedPosition.x,
    y: savedPosition.y
  });
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

function clampOverlayBoundsToWorkArea(bounds: OverlayBounds): OverlayBounds {
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - bounds.width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - bounds.height);

  return {
    ...bounds,
    x: Math.max(workArea.x, Math.min(bounds.x, maxX)),
    y: Math.max(workArea.y, Math.min(bounds.y, maxY))
  };
}

function createOverlayWindow(): BrowserWindow {
  const initialBounds = getTopRightOverlayBounds();
  overlayAnchorBounds = initialBounds;
  overlayMode = "default";
  const window = new BrowserWindow({
    ...initialBounds,
    minWidth: 1,
    minHeight: 1,
    maxWidth: Math.max(OVERLAY_DEFAULT_SIZE.width, OVERLAY_EXPANDED_SIZE.width),
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
  window.setBackgroundColor("#00000000");
  applyOverlayPinned(window, true);
  setOverlayMousePassthrough(window, false);
  window.loadURL(rendererUrl("/overlay"));

  window.webContents.on("did-finish-load", () => {
    window.webContents.send("overlay:mode-changed", overlayMode);
    window.webContents.send("overlay:expanded-changed", overlayMode === "expanded");
  });

  window.on("show", () => applyOverlayPinned(window, true));
  window.on("focus", () => applyOverlayPinned(window, true));
  window.on("blur", () => applyOverlayPinned(window, true));

  window.on("closed", () => {
    overlayWindow = null;
  });

  window.on("moved", () => persistOverlayPosition(window));
  window.on("resized", () => persistOverlayPosition(window));

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

async function runWithSuppressedMainWindowOverlayEvents(action: () => Promise<void>) {
  suppressMainBlurOverlay = true;
  suppressMainMinimizeOverlay = true;
  try {
    await action();
  } finally {
    setTimeout(() => {
      suppressMainBlurOverlay = false;
      suppressMainMinimizeOverlay = false;
    }, 0);
  }
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
    return;
  }

  runWithSuppressedMainBlur(() => {
    mainWindow?.hide();
  });
}

function leaveMainFullScreen(window: BrowserWindow): Promise<void> {
  const isSimpleFullScreen = process.platform === "darwin" && window.isSimpleFullScreen();
  if (!window.isFullScreen() && !isSimpleFullScreen) {
    return Promise.resolve();
  }

  return new Promise<void>((resolveLeave) => {
    let didResolve = false;
    const finish = () => {
      if (didResolve) {
        return;
      }
      didResolve = true;
      clearTimeout(timeout);
      window.off("leave-full-screen", finish);
      resolveLeave();
    };
    const timeout = setTimeout(finish, 900);

    window.once("leave-full-screen", finish);
    if (window.isFullScreen()) {
      window.setFullScreen(false);
    }
    if (isSimpleFullScreen) {
      window.setSimpleFullScreen(false);
    }
  });
}

async function minimizeMainWindowToDrawer() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
    return;
  }

  const window = mainWindow;
  await runWithSuppressedMainWindowOverlayEvents(async () => {
    restoreMainFullScreenAfterOverlay = window.isFullScreen() || (process.platform === "darwin" && window.isSimpleFullScreen());
    await leaveMainFullScreen(window);
    if (window.isDestroyed() || !window.isVisible() || window.isMinimized()) {
      return;
    }
    window.minimize();
  });
}

function destroyOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = null;
    overlayMode = "default";
    return;
  }

  overlayMode = "default";
  overlayWindow.destroy();
}

function showMainWindow() {
  destroyOverlayWindow();
  const window = ensureMainWindow();
  const shouldRestoreFullScreen = restoreMainFullScreenAfterOverlay;
  restoreMainFullScreenAfterOverlay = false;
  if (window.isMinimized()) {
    window.restore();
  }
  if (window.isFullScreen()) {
    window.setFullScreen(false);
  }
  if (process.platform === "darwin" && window.isSimpleFullScreen()) {
    window.setSimpleFullScreen(false);
  }
  window.show();
  window.focus();
  if (shouldRestoreFullScreen) {
    window.setFullScreen(true);
  }
}

function showSettingsWindow() {
  showMainWindow();
  mainWindow?.webContents.send("main:open-settings");
}

function resizeOverlayWindow(window: BrowserWindow, mode: OverlayMode) {
  if (mode === "expanded") {
    overlayAnchorBounds = window.getBounds();
    applyOverlayBounds(window, calculateExpandedOverlayBounds(overlayAnchorBounds));
    setOverlayMousePassthrough(window, false);
    window.focus();
    window.webContents.focus();
    return;
  }

  const anchor = window.getBounds();
  const size = getOverlaySize(mode);
  applyOverlayBounds(window, clampOverlayBoundsToWorkArea({
    x: anchor.x,
    y: anchor.y,
    width: size.width,
    height: size.height
  }));
  setOverlayMousePassthrough(window, false);
}

function setOverlayMode(mode: OverlayMode) {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayMode = "default";
    overlayWindow = null;
    return;
  }

  overlayMode = mode;
  resizeOverlayWindow(overlayWindow, mode);
  overlayWindow.webContents.send("overlay:mode-changed", mode);
  overlayWindow.webContents.send("overlay:expanded-changed", mode === "expanded");
}

function setOverlayExpanded(expanded: boolean) {
  setOverlayMode(expanded ? "expanded" : "default");
}

async function showOverlayWindow(options: { hideMain?: boolean } = {}) {
  if (options.hideMain ?? true) {
    await minimizeMainWindowToDrawer();
  }
  const window = ensureOverlayWindow();
  setOverlayMode("default");
  setOverlayMousePassthrough(window, false);
  window.setBackgroundColor("#00000000");
  window.show();
  applyOverlayPinned(window, true);
  window.focus();
}

function hideOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.hide();
}

async function toggleOverlayWindow() {
  const window = ensureOverlayWindow();
  if (window.isVisible()) {
    showMainWindow();
    return;
  }
  await showOverlayWindow();
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
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" }
      ]
    },
    {
      label: "Ream",
      submenu: [
        { label: "Show Main Window", click: showMainWindow },
        { label: "Show Overlay", click: () => { void showOverlayWindow(); } },
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
      { label: "Show Overlay", click: () => { void showOverlayWindow(); } },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() }
    ])
  );
  tray.on("click", () => { void toggleOverlayWindow(); });
}

function registerShortcuts() {
  const overlayRegistered = globalShortcut.register("CommandOrControl+Shift+T", () => { void toggleOverlayWindow(); });
  const quickNoteRegistered = globalShortcut.register("CommandOrControl+Shift+O", () => { void showQuickNoteOverlay(); });
  if (!overlayRegistered) {
    console.warn("Unable to register Cmd/Ctrl+Shift+T for the overlay toggle.");
  }
  if (!quickNoteRegistered) {
    console.warn("Unable to register Cmd/Ctrl+Shift+O for quick notes.");
  }
}

function sendOverlayContextCommand(command: OverlayContextCommand) {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.webContents.send("overlay:context-command", command);
}

function showOverlayContextMenu(input: OverlayContextMenuInput) {
  const isPaused = input.timerState === "paused";
  const hasTimer = input.timerState === "running" || input.timerState === "paused";
  const menu = Menu.buildFromTemplate([
    { label: "Expand to mini", click: () => sendOverlayContextCommand("mini") },
    { label: "Expand to default", click: () => sendOverlayContextCommand("default") },
    { type: "separator" },
    { label: isPaused ? "Resume" : "Pause", enabled: hasTimer, click: () => sendOverlayContextCommand("pause-resume") },
    { label: "End session", enabled: hasTimer, click: () => sendOverlayContextCommand("stop") },
    { type: "separator" },
    { label: "Settings", click: () => sendOverlayContextCommand("settings") }
  ]);

  menu.popup({ window: overlayWindow ?? undefined });
}

async function readOllamaStatus(model = ""): Promise<OllamaHealthStatus> {
  const checkedModel = model.trim() || DEFAULT_OLLAMA_MODEL;
  if (!aiSidecar) {
    return {
      ok: false,
      ollama: { ok: false },
      model: checkedModel,
      checkedModel,
      fallbackModel: FALLBACK_OLLAMA_MODEL,
      modelAvailable: false,
      fallbackAvailable: false
    };
  }

  const healthUrl = new URL(`${aiSidecar.url}/ai/health`);
  if (model.trim()) {
    healthUrl.searchParams.set("model", model.trim());
  }
  const response = await fetch(healthUrl);
  const payload = await response.json() as unknown;
  return normalizeOllamaHealthStatus(payload);
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

function getOllamaLibraryUrl(model: string): string {
  try {
    const normalizedModel = normalizeOllamaModelName(model);
    const baseModel = normalizedModel.split(":")[0]?.trim();
    return baseModel ? `${OLLAMA_LIBRARY_URL}/${encodeURIComponent(baseModel)}` : OLLAMA_LIBRARY_URL;
  } catch {
    return OLLAMA_LIBRARY_URL;
  }
}

function bringExternalBrowserToFront(url: string) {
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
    overlayWindow.hide();
  }

  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    hideMainWindow();
  }

  void shell.openExternal(url);
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
    checkedModel: typeof payload.checkedModel === "string" && payload.checkedModel.trim()
      ? payload.checkedModel.trim()
      : typeof payload.model === "string" && payload.model.trim()
        ? payload.model.trim()
        : DEFAULT_OLLAMA_MODEL,
    fallbackModel: typeof payload.fallbackModel === "string" && payload.fallbackModel.trim() ? payload.fallbackModel.trim() : FALLBACK_OLLAMA_MODEL,
    modelAvailable: payload.modelAvailable === true,
    fallbackAvailable: payload.fallbackAvailable === true
  };
}

async function showQuickNoteOverlay() {
  await showOverlayWindow({ hideMain: false });
  const window = overlayWindow;
  if (window && !window.isDestroyed() && window.webContents.isLoading()) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 900);
      window.webContents.once("did-finish-load", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  setOverlayExpanded(true);
  overlayWindow?.webContents.send("overlay:quick-note-requested");
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

  ipcMain.handle("window:show-settings", () => {
    showSettingsWindow();
  });

  ipcMain.handle("window:set-overlay-pinned", (_event, pinned: boolean) => {
    const window = ensureOverlayWindow();
    applyOverlayPinned(window, pinned);
    return window.isAlwaysOnTop();
  });

  ipcMain.handle("window:show-overlay", async (_event, options?: { hideMain?: boolean }) => {
    await showOverlayWindow(options);
  });

  ipcMain.handle("window:set-overlay-expanded", (_event, expanded: boolean) => {
    setOverlayExpanded(expanded);
  });

  ipcMain.handle("window:get-overlay-mode", () => overlayMode);

  ipcMain.handle("window:set-overlay-mode", (_event, mode: OverlayMode) => {
    setOverlayMode(mode);
  });

  ipcMain.handle("window:show-overlay-context-menu", (_event, input: OverlayContextMenuInput) => {
    showOverlayContextMenu(input);
  });

  ipcMain.handle("window:set-overlay-interactive", (_event, interactive: boolean) => {
    const window = ensureOverlayWindow();
    setOverlayMousePassthrough(window, !interactive);
  });

  ipcMain.handle("window:focus-overlay", () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.focus();
      overlayWindow.webContents.focus();
    }
  });

  ipcMain.handle("window:toggle-overlay", async () => {
    await toggleOverlayWindow();
  });

  ipcMain.handle("window:minimize-overlay", () => {
    overlayWindow?.minimize();
  });

  ipcMain.handle("window:close-overlay", () => {
    hideOverlayWindow();
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

  ipcMain.handle("ai:generate-recap", async (_event, input: GenerateRecapRequest): Promise<GenerateRecapResult> => {
    if (!aiSidecar) {
      throw new Error("AI sidecar is not available. Restart Ream and try again.");
    }
    const model = input.model?.trim() || DEFAULT_OLLAMA_MODEL;
    const status = await readOllamaStatus(model);
    if (!status.ollama.ok) {
      throw new Error("Ollama is not running. Open Local AI settings to finish setup, then try again.");
    }
    if (!status.modelAvailable && !(model === DEFAULT_OLLAMA_MODEL && status.fallbackAvailable)) {
      throw new Error(`The local AI model ${model} is not installed. Open Local AI settings to pull it, then try again.`);
    }
    const response = await fetch(`${aiSidecar.url}/ai/recap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, model })
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Unable to generate recap with AI.";
      throw new Error(message);
    }
    return {
      model: response.headers.get("x-ream-ai-model")?.trim() || model,
      output: validateGeneratedRecapOutput(payload)
    };
  });

  ipcMain.handle("journal:confirm-recap-conflict", async (_event, sourceLabel: string) => {
    const options: Electron.MessageBoxOptions = {
      type: "question",
      title: "Recap already exists",
      message: `A recap for ${sourceLabel} already exists.`,
      detail: "Replace the newest matching recap or append another timestamped recap?",
      buttons: ["Replace", "Append", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    };
    const result = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
    return result.response === 0 ? "replace" : result.response === 1 ? "append" : "cancel";
  });

  ipcMain.handle("ai:ollama-status", (_event, model?: string) => readOllamaStatus(typeof model === "string" ? model : ""));

  ipcMain.handle("ai:open-ollama-download", async () => {
    bringExternalBrowserToFront(OLLAMA_DOWNLOAD_URL);
  });

  ipcMain.handle("ai:open-ollama-library", async (_event, model: string) => {
    bringExternalBrowserToFront(getOllamaLibraryUrl(model));
  });

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
