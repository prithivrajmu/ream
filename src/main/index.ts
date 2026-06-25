import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;

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
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    title: "Timesheet Tracker",
    backgroundColor: "#f7f8fb",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
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

  return window;
}

function createOverlayWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 360,
    height: 220,
    minWidth: 320,
    minHeight: 180,
    maxWidth: 520,
    maxHeight: 520,
    title: "Timesheet Overlay",
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#10131a",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.loadURL(rendererUrl("/overlay"));

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

app.whenReady().then(() => {
  ensureMainWindow();
  ensureOverlayWindow();

  ipcMain.handle("window:show-main", () => {
    const window = ensureMainWindow();
    window.show();
    window.focus();
  });

  ipcMain.handle("window:set-overlay-pinned", (_event, pinned: boolean) => {
    const window = ensureOverlayWindow();
    window.setAlwaysOnTop(pinned);
    return window.isAlwaysOnTop();
  });

  ipcMain.handle("window:close-overlay", () => {
    overlayWindow?.hide();
  });

  app.on("activate", () => {
    ensureMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
