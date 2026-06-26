import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, shell } from "electron";
import { join } from "node:path";
import {
  calculateExpandedOverlayBounds as calculateExpandedOverlayBoundsForWorkArea,
  getTopRightOverlayBounds as getTopRightOverlayBoundsForWorkArea,
  type OverlayBounds,
  OVERLAY_COMPACT_SIZE,
  OVERLAY_EXPANDED_SIZE
} from "../shared/overlayBounds";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

let overlayAnchorBounds: OverlayBounds | null = null;
let overlayExpanded = false;

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
    if (!window.isMinimized()) {
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

  overlayExpanded = expanded;
  resizeOverlayWindow(expanded);
  overlayWindow?.webContents.send("overlay:expanded-changed", expanded);
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
    setOverlayExpanded(false);
    window.hide();
    return;
  }
  window.show();
  applyOverlayPinned(window, true);
  window.focus();
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

app.whenReady().then(() => {
  ensureMainWindow();
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
    setOverlayExpanded(false);
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
