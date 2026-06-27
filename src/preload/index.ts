import { contextBridge, ipcRenderer } from "electron";
import type { ImproveNoteRequest, ImproveNoteResult } from "../shared/ai";

const desktopApi = {
  showMainWindow: () => ipcRenderer.invoke("window:show-main"),
  showOverlayWindow: () => ipcRenderer.invoke("window:show-overlay"),
  toggleOverlayWindow: () => ipcRenderer.invoke("window:toggle-overlay"),
  setOverlayPinned: (pinned: boolean) => ipcRenderer.invoke("window:set-overlay-pinned", pinned) as Promise<boolean>,
  setOverlayExpanded: (expanded: boolean) => ipcRenderer.invoke("window:set-overlay-expanded", expanded),
  setOverlayInteractive: (interactive: boolean) => ipcRenderer.invoke("window:set-overlay-interactive", interactive),
  minimizeOverlay: () => ipcRenderer.invoke("window:minimize-overlay"),
  improveNoteWithAi: (input: ImproveNoteRequest) => ipcRenderer.invoke("ai:improve-note", input) as Promise<ImproveNoteResult>,
  onOverlayExpandedChanged: (callback: (expanded: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, expanded: boolean) => callback(expanded);
    ipcRenderer.on("overlay:expanded-changed", listener);
    return () => {
      ipcRenderer.off("overlay:expanded-changed", listener);
    };
  },
  closeOverlay: () => ipcRenderer.invoke("window:close-overlay")
};

contextBridge.exposeInMainWorld("timesheetDesktop", desktopApi);

export type TimesheetDesktopApi = typeof desktopApi;
