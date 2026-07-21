import { describe, expect, it } from "vitest";
import { JOURNAL_COMMAND_REGISTRY, parseJournalCommand } from "../shared/journalCommands";

describe("journal commands", () => {
  const now = new Date(2026, 6, 11, 14, 30);

  it("parses yesterday and named selectors case-insensitively", () => {
    expect(parseJournalCommand("  /RECAP   @YESTERDAY  ", now)).toMatchObject({
      kind: "recap",
      range: { startDateKey: "2026-07-10", endDateKey: "2026-07-10" }
    });
    expect(parseJournalCommand("/recap @previousweek", now)).toMatchObject({
      kind: "recap",
      range: { startDateKey: "2026-06-29", endDateKey: "2026-07-05" }
    });
  });

  it("accepts real explicit dates including leap day", () => {
    expect(parseJournalCommand("/recap @02-29-2024", now)).toMatchObject({
      kind: "recap",
      range: { startDateKey: "2024-02-29", endDateKey: "2024-02-29" }
    });
  });

  it("returns help for malformed, impossible, extra, and unknown commands", () => {
    for (const command of ["/recap", "/recap @02-30-2026", "/recap @yesterday extra", "/recap @tomorrow", "/today"]) {
      const result = parseJournalCommand(command, now);
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.helpMarkdown).toContain("/recap @yesterday");
      }
    }
  });

  it("exposes future commands only as unimplemented registry entries", () => {
    expect(JOURNAL_COMMAND_REGISTRY).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "today", implemented: false }),
      expect.objectContaining({ name: "template", implemented: false })
    ]));
    expect(parseJournalCommand("ordinary note", now)).toEqual({ kind: "not-command" });
  });
});
