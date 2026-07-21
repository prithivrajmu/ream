import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { formatImprovedNoteMarkdown, validateImprovedNoteOutput } from "../shared/ai";
import { createNoteAiSuggestion, updateNoteAiSuggestionStatus } from "../shared/aiSuggestionRepository";
import { ReamDatabase } from "../shared/db";

let database: ReamDatabase | null = null;

function createTestDatabase(): ReamDatabase {
  database = new ReamDatabase(`ream-ai-test-${crypto.randomUUID()}`);
  return database;
}

afterEach(async () => {
  if (database) {
    await database.delete();
    database = null;
  }
});

describe("AI note suggestions", () => {
  it("stores suggestions without changing the source note", async () => {
    const db = createTestDatabase();
    const output = {
      clean_note: "Finished the review and noted one blocker.",
      summary: "Review completed with one blocker.",
      next_steps: ["Follow up on blocker"],
      blockers: ["Missing API credentials"],
      tags: ["review"]
    };

    const suggestion = await createNoteAiSuggestion(db, {
      noteId: "entry-1",
      model: "llama3.2:3b",
      inputText: "done review blocker api creds",
      outputJson: output,
      durationMs: 1234.4
    });

    expect(suggestion.status).toBe("pending");
    expect(suggestion.inputText).toBe("done review blocker api creds");
    expect(suggestion.outputJson).toEqual(output);
    expect(suggestion.durationMs).toBe(1234);
    expect(suggestion.statusUpdatedAt).toBeNull();

    const accepted = await updateNoteAiSuggestionStatus(db, suggestion.id, "accepted", new Date("2026-01-01T00:00:00.000Z"));
    expect(accepted.status).toBe("accepted");
    expect(accepted.statusUpdatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(accepted.acceptedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("normalizes and validates model output", () => {
    expect(validateImprovedNoteOutput({
      clean_note: " Clean note ",
      summary: " Summary ",
      next_steps: [" Step ", ""],
      blockers: [],
      tags: [" Planning ", "CLIENT"]
    })).toEqual({
      clean_note: "Clean note",
      summary: "Summary",
      next_steps: ["Step"],
      blockers: [],
      tags: ["planning", "client"]
    });

    expect(() => validateImprovedNoteOutput({ clean_note: "x" })).toThrow("summary");
  });

  it("formats the complete suggestion as a saved Markdown note", () => {
    expect(formatImprovedNoteMarkdown({
      clean_note: "Completed the API review and documented the authentication gap.",
      summary: "The API review is complete with one unresolved dependency.",
      next_steps: ["Request staging credentials", "Retest the authenticated endpoint"],
      blockers: ["Staging credentials are unavailable"],
      tags: ["API review", "#authentication"]
    })).toBe(`## Note

Completed the API review and documented the authentication gap.

## Summary

The API review is complete with one unresolved dependency.

## To-do

- [ ] Request staging credentials
- [ ] Retest the authenticated endpoint

## Blockers

- Staging credentials are unavailable

## Tags

#api-review #authentication`);
  });

  it("keeps empty suggestion sections explicit", () => {
    const markdown = formatImprovedNoteMarkdown({
      clean_note: "Reviewed the implementation.",
      summary: "The implementation was reviewed.",
      next_steps: [],
      blockers: [],
      tags: []
    });

    expect(markdown).toContain("_No follow-up actions identified._");
    expect(markdown).toContain("_No blockers identified._");
    expect(markdown).toContain("_No tags suggested._");
  });
});
