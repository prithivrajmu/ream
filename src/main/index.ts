import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, shell } from "electron";
import { join } from "node:path";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

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

function showMainWindow() {
  const window = ensureMainWindow();
  window.show();
  window.focus();
}

function showOverlayWindow() {
  const window = ensureOverlayWindow();
  window.show();
  window.focus();
}

function toggleOverlayWindow() {
  const window = ensureOverlayWindow();
  if (window.isVisible()) {
    window.hide();
    return;
  }
  window.show();
  window.focus();
}

function createTrayIcon() {
  return nativeImage.createFromDataURL(
    "data:image/svg+xml;utf8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#2563eb"/><path d="M4 4h8v2H9v6H7V6H4z" fill="white"/></svg>'
      )
  );
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
      label: "Timesheet",
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
  tray.setToolTip("Timesheet Tracker");
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

app.whenReady().then(() => {
  ensureMainWindow();
  ensureOverlayWindow();
  buildAppMenu();
  setupTray();
  registerShortcuts();

  ipcMain.handle("window:show-main", () => {
    showMainWindow();
  });

  ipcMain.handle("window:set-overlay-pinned", (_event, pinned: boolean) => {
    const window = ensureOverlayWindow();
    window.setAlwaysOnTop(pinned);
    return window.isAlwaysOnTop();
  });

  ipcMain.handle("window:show-overlay", () => {
    showOverlayWindow();
  });

  ipcMain.handle("window:toggle-overlay", () => {
    toggleOverlayWindow();
  });

  ipcMain.handle("window:close-overlay", () => {
    overlayWindow?.hide();
  });

  app.on("activate", () => {
    ensureMainWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
