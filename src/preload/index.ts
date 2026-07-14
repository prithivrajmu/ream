import { contextBridge, ipcRenderer } from "electron";
import type { GenerateRecapRequest, GenerateRecapResult, ImproveNoteRequest, ImproveNoteResult, OllamaHealthStatus } from "../shared/ai";
import type { OverlayMode } from "../shared/overlayBounds";

export interface ReamDataLocationInfo {
  path: string;
  isCustom: boolean;
  defaultPath: string;
}

export type OverlayContextCommand = "mini" | "default" | "pause-resume" | "stop" | "settings";

export interface OverlayContextMenuInput {
  timerState: "idle" | "running" | "paused" | "stopped";
}

export interface ShowOverlayWindowInput {
  hideMain?: boolean;
}

export type RecapConflictChoice = "replace" | "append" | "cancel";

const desktopApi = {
  showMainWindow: () => ipcRenderer.invoke("window:show-main"),
  showSettingsWindow: () => ipcRenderer.invoke("window:show-settings"),
  showOverlayWindow: (input?: ShowOverlayWindowInput) => ipcRenderer.invoke("window:show-overlay", input),
  toggleOverlayWindow: () => ipcRenderer.invoke("window:toggle-overlay"),
  setOverlayPinned: (pinned: boolean) => ipcRenderer.invoke("window:set-overlay-pinned", pinned) as Promise<boolean>,
  setOverlayExpanded: (expanded: boolean) => ipcRenderer.invoke("window:set-overlay-expanded", expanded),
  getOverlayMode: () => ipcRenderer.invoke("window:get-overlay-mode") as Promise<OverlayMode>,
  setOverlayMode: (mode: OverlayMode) => ipcRenderer.invoke("window:set-overlay-mode", mode),
  showOverlayContextMenu: (input: OverlayContextMenuInput) => ipcRenderer.invoke("window:show-overlay-context-menu", input),
  setOverlayInteractive: (interactive: boolean) => ipcRenderer.invoke("window:set-overlay-interactive", interactive),
  focusOverlayWindow: () => ipcRenderer.invoke("window:focus-overlay") as Promise<void>,
  minimizeOverlay: () => ipcRenderer.invoke("window:minimize-overlay"),
  improveNoteWithAi: (input: ImproveNoteRequest) => ipcRenderer.invoke("ai:improve-note", input) as Promise<ImproveNoteResult>,
  generateRecapWithAi: (input: GenerateRecapRequest) => ipcRenderer.invoke("ai:generate-recap", input) as Promise<GenerateRecapResult>,
  confirmRecapConflict: (sourceLabel: string) => ipcRenderer.invoke("journal:confirm-recap-conflict", sourceLabel) as Promise<RecapConflictChoice>,
  getOllamaStatus: (model?: string) => ipcRenderer.invoke("ai:ollama-status", model) as Promise<OllamaHealthStatus>,
  openOllamaDownload: () => ipcRenderer.invoke("ai:open-ollama-download") as Promise<void>,
  openOllamaLibrary: (model: string) => ipcRenderer.invoke("ai:open-ollama-library", model) as Promise<void>,
  getDataLocation: () => ipcRenderer.invoke("data:get-location") as Promise<ReamDataLocationInfo>,
  chooseDataLocation: () => ipcRenderer.invoke("data:choose-location") as Promise<ReamDataLocationInfo | null>,
  onOverlayExpandedChanged: (callback: (expanded: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, expanded: boolean) => callback(expanded);
    ipcRenderer.on("overlay:expanded-changed", listener);
    return () => {
      ipcRenderer.off("overlay:expanded-changed", listener);
    };
  },
  onOverlayModeChanged: (callback: (mode: OverlayMode) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, mode: OverlayMode) => callback(mode);
    ipcRenderer.on("overlay:mode-changed", listener);
    return () => {
      ipcRenderer.off("overlay:mode-changed", listener);
    };
  },
  onOverlayContextCommand: (callback: (command: OverlayContextCommand) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: OverlayContextCommand) => callback(command);
    ipcRenderer.on("overlay:context-command", listener);
    return () => {
      ipcRenderer.off("overlay:context-command", listener);
    };
  },
  onOpenSettingsRequested: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("main:open-settings", listener);
    return () => {
      ipcRenderer.off("main:open-settings", listener);
    };
  },
  onQuickNoteRequested: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("overlay:quick-note-requested", listener);
    return () => {
      ipcRenderer.off("overlay:quick-note-requested", listener);
    };
  },
  closeOverlay: () => ipcRenderer.invoke("window:close-overlay")
};

contextBridge.exposeInMainWorld("reamDesktop", desktopApi);
contextBridge.exposeInMainWorld("timesheetDesktop", desktopApi);

export type ReamDesktopApi = typeof desktopApi;
