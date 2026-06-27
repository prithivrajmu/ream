import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { validateImprovedNoteOutput } from "../shared/ai";
import { createNoteAiSuggestion, updateNoteAiSuggestionStatus } from "../shared/aiSuggestionRepository";
import { TimesheetDatabase } from "../shared/db";

let database: TimesheetDatabase | null = null;

function createTestDatabase(): TimesheetDatabase {
  database = new TimesheetDatabase(`timesheet-ai-test-${crypto.randomUUID()}`);
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
      outputJson: output
    });

    expect(suggestion.status).toBe("pending");
    expect(suggestion.inputText).toBe("done review blocker api creds");
    expect(suggestion.outputJson).toEqual(output);

    const accepted = await updateNoteAiSuggestionStatus(db, suggestion.id, "accepted", new Date("2026-01-01T00:00:00.000Z"));
    expect(accepted.status).toBe("accepted");
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
});
