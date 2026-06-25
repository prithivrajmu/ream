import { contextBridge, ipcRenderer } from "electron";

const desktopApi = {
  showMainWindow: () => ipcRenderer.invoke("window:show-main"),
  setOverlayPinned: (pinned: boolean) => ipcRenderer.invoke("window:set-overlay-pinned", pinned) as Promise<boolean>,
  closeOverlay: () => ipcRenderer.invoke("window:close-overlay")
};

contextBridge.exposeInMainWorld("timesheetDesktop", desktopApi);

export type TimesheetDesktopApi = typeof desktopApi;
