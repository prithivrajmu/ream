import { describe, expect, it } from "vitest";
import { autoHideVisibleSidebar, JOURNAL_SIDEBAR_AUTO_HIDE_MS, restoreSidebarOutsideJournal } from "../renderer/sidebarVisibility";

describe("journal sidebar visibility", () => {
  it("auto-hides a visible sidebar after the configured three seconds", () => {
    expect(JOURNAL_SIDEBAR_AUTO_HIDE_MS).toBe(3000);
    expect(autoHideVisibleSidebar("visible")).toBe("auto-hidden");
  });

  it("never overwrites a manual hide choice", () => {
    expect(autoHideVisibleSidebar("manual-hidden")).toBe("manual-hidden");
    expect(restoreSidebarOutsideJournal("manual-hidden")).toBe("manual-hidden");
  });

  it("restores only automatically hidden sidebars outside Journal", () => {
    expect(restoreSidebarOutsideJournal("auto-hidden")).toBe("visible");
    expect(restoreSidebarOutsideJournal("visible")).toBe("visible");
  });
});
