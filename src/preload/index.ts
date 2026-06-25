import { contextBridge, ipcRenderer } from "electron";

const desktopApi = {
  showMainWindow: () => ipcRenderer.invoke("window:show-main"),
  showOverlayWindow: () => ipcRenderer.invoke("window:show-overlay"),
  toggleOverlayWindow: () => ipcRenderer.invoke("window:toggle-overlay"),
  setOverlayPinned: (pinned: boolean) => ipcRenderer.invoke("window:set-overlay-pinned", pinned) as Promise<boolean>,
  setOverlayExpanded: (expanded: boolean) => ipcRenderer.invoke("window:set-overlay-expanded", expanded),
  closeOverlay: () => ipcRenderer.invoke("window:close-overlay")
};

contextBridge.exposeInMainWorld("timesheetDesktop", desktopApi);

export type TimesheetDesktopApi = typeof desktopApi;
