import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecoveryDraftsPanel } from "../renderer/notes/RecoveryDraftsPanel";

describe("recovery drafts panel", () => {
  it("shows retained text and its original baseline without interpreting markup", () => {
    const html = renderToStaticMarkup(createElement(RecoveryDraftsPanel, { drafts: [{
      contextId: "timer:2026-09-16T09:00:00Z:window:overlay", updatedAt: "2026-09-16T09:05:00Z",
      markdown: "<script>draft text</script>", baseValue: "Original version"
    }] }));
    expect(html).toContain("Recover unsaved notes");
    expect(html).toContain("Overlay");
    expect(html).toContain("&lt;script&gt;draft text&lt;/script&gt;");
    expect(html).toContain("Original version");
    expect(html).toMatch(/readonly=""/i);
    expect(html).toContain("Copy draft");
    expect(html).toContain("Download Markdown");
    expect(html).not.toContain("Delete");
  });

  it("distinguishes empty edits, missing drafts, and unavailable storage", () => {
    const emptyDraft = { contextId: "journal:2026-09-16", updatedAt: "invalid timestamp", markdown: "" };
    expect(renderToStaticMarkup(createElement(RecoveryDraftsPanel, { drafts: [emptyDraft] }))).toContain("intentionally clears the note");
    expect(renderToStaticMarkup(createElement(RecoveryDraftsPanel, { drafts: [emptyDraft] }))).toContain("Unknown save time");
    expect(renderToStaticMarkup(createElement(RecoveryDraftsPanel, { drafts: [] }))).toContain("No recovery drafts found");
    const unavailable = renderToStaticMarkup(createElement(RecoveryDraftsPanel, { drafts: [], unavailable: true }));
    expect(unavailable).toContain("Recovery storage is unavailable");
    expect(unavailable).not.toContain("No recovery drafts found");
  });
});
