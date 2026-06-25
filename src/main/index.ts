import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, shell } from "electron";
import { join } from "node:path";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const OVERLAY_COMPACT_SIZE = { width: 420, height: 72 };
const OVERLAY_EXPANDED_SIZE = { width: 520, height: 420 };
const OVERLAY_SCREEN_MARGIN = 18;

type OverlayBounds = { x: number; y: number; width: number; height: number };

let overlayAnchorBounds: OverlayBounds | null = null;

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
      preload: join(__dirname, "../preload/index.mjs"),
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
  const { workArea } = screen.getPrimaryDisplay();
  return {
    width: OVERLAY_COMPACT_SIZE.width,
    height: OVERLAY_COMPACT_SIZE.height,
    x: workArea.x + workArea.width - OVERLAY_COMPACT_SIZE.width - OVERLAY_SCREEN_MARGIN,
    y: workArea.y + OVERLAY_SCREEN_MARGIN
  };
}

function calculateExpandedOverlayBounds(anchor: OverlayBounds): OverlayBounds {
  const display = screen.getDisplayMatching(anchor);
  const { workArea } = display;
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;

  return {
    width: OVERLAY_EXPANDED_SIZE.width,
    height: OVERLAY_EXPANDED_SIZE.height,
    x: Math.max(workArea.x + OVERLAY_SCREEN_MARGIN, Math.min(anchor.x, right - OVERLAY_EXPANDED_SIZE.width - OVERLAY_SCREEN_MARGIN)),
    y: Math.max(workArea.y + OVERLAY_SCREEN_MARGIN, Math.min(anchor.y, bottom - OVERLAY_EXPANDED_SIZE.height - OVERLAY_SCREEN_MARGIN))
  };
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
  const window = new BrowserWindow({
    ...initialBounds,
    minWidth: 320,
    minHeight: 64,
    maxWidth: OVERLAY_EXPANDED_SIZE.width,
    maxHeight: OVERLAY_EXPANDED_SIZE.height,
    title: "Timesheet Overlay",
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyOverlayPinned(window, true);
  setOverlayMousePassthrough(window, true);
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

function showMainWindow() {
  const window = ensureMainWindow();
  window.show();
  window.focus();
}

function resizeOverlayWindow(expanded: boolean) {
  const window = ensureOverlayWindow();
  if (expanded) {
    overlayAnchorBounds = window.getBounds();
    applyOverlayBounds(window, calculateExpandedOverlayBounds(overlayAnchorBounds));
    setOverlayMousePassthrough(window, false);
    return;
  }

  const anchor = overlayAnchorBounds ?? window.getBounds();
  applyOverlayBounds(window, {
    x: anchor.x,
    y: anchor.y,
    width: OVERLAY_COMPACT_SIZE.width,
    height: OVERLAY_COMPACT_SIZE.height
  });
  setOverlayMousePassthrough(window, true);
}

function showOverlayWindow() {
  const window = ensureOverlayWindow();
  window.show();
  applyOverlayPinned(window, true);
  window.focus();
}

function toggleOverlayWindow() {
  const window = ensureOverlayWindow();
  if (window.isVisible()) {
    window.hide();
    return;
  }
  window.show();
  applyOverlayPinned(window, true);
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
    applyOverlayPinned(window, pinned);
    return window.isAlwaysOnTop();
  });

  ipcMain.handle("window:show-overlay", () => {
    showOverlayWindow();
  });

  ipcMain.handle("window:set-overlay-expanded", (_event, expanded: boolean) => {
    resizeOverlayWindow(expanded);
  });

  ipcMain.handle("window:set-overlay-interactive", (_event, interactive: boolean) => {
    const window = ensureOverlayWindow();
    setOverlayMousePassthrough(window, !interactive);
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
