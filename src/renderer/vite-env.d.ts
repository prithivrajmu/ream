/// <reference types="vite/client" />

import type { ReamDesktopApi } from "../preload";

declare global {
  interface Window {
    reamDesktop?: ReamDesktopApi;
    timesheetDesktop?: ReamDesktopApi;
  }
}
