/// <reference types="vite/client" />

import type { TimesheetDesktopApi } from "../preload";

declare global {
  interface Window {
    timesheetDesktop?: TimesheetDesktopApi;
  }
}
