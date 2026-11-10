import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EntryConflictNotice } from "../renderer/EntryConflictNotice";
import { AiNoteApplyNotice } from "../renderer/notes/AiNoteApplyNotice";
import type { TimeEntry } from "../shared/domain";

describe("completed entry review UI", () => {
  const entry: TimeEntry = {
    id: "entry", taskId: "task", projectIds: ["missing-project"],
    startedAt: "2026-09-17T09:00:12.345Z", endedAt: "2026-09-17T10:00:12.345Z",
    durationSeconds: 81, note: "<script>Saved note</script>", createdAt: "", updatedAt: ""
  };
  it("shows all changed fields safely and requires an explicit entry-level choice", () => {
    const html = renderToStaticMarkup(createElement(EntryConflictNotice, {
      saved: entry, local: { ...entry, taskId: "new-task", note: "", projectIds: [] }, tasks: [], projects: [],
      onUseSaved: () => {}, onSaveMine: () => {}
    }));
    expect(html).toContain("&lt;script&gt;Saved note&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Task: new-task");
    expect(html).toContain("Projects: missing-project");
    expect(html).toContain("Projects: None");
    expect(html).toContain("(Empty note)");
    expect(html).toContain("Tracked duration:");
    expect(html).toContain('type="button">Use saved entry');
    expect(html).toContain('type="button">Save my entry');
  });
  it.each([false, true])("keeps stale AI suggestions read-only (restored: %s)", (restored) => {
    const html = renderToStaticMarkup(createElement(AiNoteApplyNotice, { currentNote: "New saved note", restored }));
    expect(html).toContain(restored ? "workspace was restored" : "saved note changed");
    expect(html).toContain("New saved note");
    expect(html).toContain("cannot replace it");
    expect(html).not.toContain("<button");
  });
});
