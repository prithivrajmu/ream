import { describe, expect, it } from "vitest";
import { AI_MEANING_CASES, faithfulNote } from "./fixtures/aiMeaningCorpus";
import { evaluateAiMeaning } from "./fixtures/evaluateAiMeaning";

describe.each(AI_MEANING_CASES)("meaning evaluator: $id", (fixture) => {
  it("accepts an unchanged source narrative", () => {
    const note = { ...faithfulNote(fixture), clean_note: fixture.source, summary: fixture.source };
    if (!fixture.recapOnly) expect(evaluateAiMeaning(fixture, "note", note)).toEqual([]);
    expect(evaluateAiMeaning(fixture, "recap", { summary: fixture.source, todos: note.next_steps })).toEqual([]);
  });

  it("accepts two faithful paraphrases through both output paths", () => {
    for (const variant of [0, 1]) {
      const note = faithfulNote(fixture, variant);
      if (!fixture.recapOnly) expect(evaluateAiMeaning(fixture, "note", note)).toEqual([]);
      expect(evaluateAiMeaning(fixture, "recap", { summary: note.summary, todos: note.next_steps })).toEqual([]);
    }
  });

  it("rejects each known status inversion in narratives even with correct action arrays", () => {
    const note = faithfulNote(fixture);
    for (const bad of fixture.badNarratives) {
      if (!fixture.recapOnly) {
        for (const field of ["clean_note", "summary"] as const) {
          expect(evaluateAiMeaning(fixture, "note", { ...note, [field]: bad }).some((failure) => failure.startsWith(field)), `${field}: ${bad}`).toBe(true);
        }
      }
      expect(evaluateAiMeaning(fixture, "recap", { summary: bad, todos: note.next_steps }).some((failure) => failure.startsWith("summary")), bad).toBe(true);
    }
  });

  it("rejects contradictions appended to an otherwise faithful narrative", () => {
    const note = faithfulNote(fixture);
    for (const bad of fixture.badNarratives) {
      const contradictory = `${note.summary} ${bad}`;
      expect(evaluateAiMeaning(fixture, "recap", { summary: contradictory, todos: note.next_steps }).some((failure) => failure.includes("contradicted meaning")), contradictory).toBe(true);
      if (!fixture.recapOnly) expect(evaluateAiMeaning(fixture, "note", { ...note, clean_note: contradictory }).some((failure) => failure.includes("contradicted meaning")), contradictory).toBe(true);
    }
  });

  it("rejects invented or reversed tasks despite a faithful narrative", () => {
    const note = faithfulNote(fixture);
    const wrongActions = [...note.next_steps, fixture.badAction];
    if (!fixture.recapOnly) expect(evaluateAiMeaning(fixture, "note", { ...note, next_steps: wrongActions }).some((failure) => failure.startsWith("next_steps"))).toBe(true);
    expect(evaluateAiMeaning(fixture, "recap", { summary: note.summary, todos: wrongActions }).some((failure) => failure.startsWith("todos"))).toBe(true);
  });

  it("cannot pass with blank narratives or a schema-only placeholder", () => {
    expect(evaluateAiMeaning(fixture, "recap", { summary: "", todos: [] }).length).toBeGreaterThan(0);
    if (!fixture.recapOnly) expect(evaluateAiMeaning(fixture, "note", { ...faithfulNote(fixture), clean_note: "Made progress.", summary: "Made progress." }).length).toBeGreaterThan(0);
  });
});

it("requires stated follow-ups and current blockers, and rejects resolved blockers", () => {
  for (const fixture of AI_MEANING_CASES.filter((item) => !item.recapOnly)) {
    const note = faithfulNote(fixture);
    if (fixture.actions.length) {
      expect(evaluateAiMeaning(fixture, "note", { ...note, next_steps: [] }).some((failure) => failure.startsWith("next_steps"))).toBe(true);
      expect(evaluateAiMeaning(fixture, "recap", { summary: note.summary, todos: [] }).some((failure) => failure.startsWith("todos"))).toBe(true);
    }
    if (fixture.blockers.length) expect(evaluateAiMeaning(fixture, "note", { ...note, blockers: [] }).some((failure) => failure.startsWith("blockers"))).toBe(true);
    else expect(evaluateAiMeaning(fixture, "note", { ...note, blockers: ["Missing credentials."] }).some((failure) => failure.startsWith("blockers"))).toBe(true);
  }
});

it("reports schema failures separately from meaning failures", () => {
  expect(evaluateAiMeaning(AI_MEANING_CASES[0], "note", {})).toEqual([expect.stringMatching(/^schema:/)]);
  expect(evaluateAiMeaning(AI_MEANING_CASES[0], "recap", { summary: "Done", todos: "bad" })).toEqual([expect.stringMatching(/^schema:/)]);
});

it("does not mistake a negated completion for completed draft review", () => {
  const fixture = AI_MEANING_CASES.find((item) => item.id === "planned-only")!;
  for (const prefix of ["Have not reviewed", "Never reviewed", "Haven't reviewed"]) {
    const summary = `${prefix} the draft. Plan to review the draft tomorrow.`;
    expect(evaluateAiMeaning(fixture, "note", { ...faithfulNote(fixture), summary, clean_note: summary })).toEqual([]);
    expect(evaluateAiMeaning(fixture, "recap", { summary, todos: fixture.faithfulActions })).toEqual([]);
  }
});

it("rejects resolved or invented content appended to a current blocker", () => {
  const fixture = AI_MEANING_CASES.find((item) => item.id === "current-blocker")!;
  for (const blocker of ["Missing credentials were restored.", "Missing credentials and an invented outage."]) {
    expect(evaluateAiMeaning(fixture, "note", { ...faithfulNote(fixture), blockers: [blocker] }).some((failure) => failure.startsWith("blockers"))).toBe(true);
  }
});
