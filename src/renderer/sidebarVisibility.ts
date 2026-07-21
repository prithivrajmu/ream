export type SidebarVisibility = "visible" | "manual-hidden" | "auto-hidden";

export const JOURNAL_SIDEBAR_AUTO_HIDE_MS = 3000;

export function autoHideVisibleSidebar(current: SidebarVisibility): SidebarVisibility {
  return current === "visible" ? "auto-hidden" : current;
}

export function restoreSidebarOutsideJournal(current: SidebarVisibility): SidebarVisibility {
  return current === "auto-hidden" ? "visible" : current;
}
