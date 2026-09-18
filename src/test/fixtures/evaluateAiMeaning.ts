import { validateGeneratedRecapOutput, validateImprovedNoteOutput } from "../../shared/ai";
import type { MeaningCase } from "./aiMeaningCorpus";

export type MeaningPath = "note" | "recap";

// Test-only rules intentionally do not alter, filter, or approve production output.
export function evaluateAiMeaning(fixture: MeaningCase, path: MeaningPath, value: unknown): string[] {
  const failures: string[] = [];
  try {
    const output = path === "note" ? validateImprovedNoteOutput(value) : validateGeneratedRecapOutput(value);
    const narratives: [string, string][] = [["summary", output.summary]];
    if ("clean_note" in output) narratives.unshift(["clean_note", output.clean_note]);
    for (const [field, text] of narratives) {
      for (const rule of fixture.narrative) {
        if (!rule.supported.test(text)) failures.push(`${field}: missing supported meaning: ${rule.meaning}`);
        if (rule.inverted.test(text)) failures.push(`${field}: contradicted meaning: ${rule.meaning}`);
      }
    }
    const actions = "next_steps" in output ? output.next_steps : output.todos;
    checkItems("next_steps" in output ? "next_steps" : "todos", actions, fixture.actions, failures);
    if ("blockers" in output) checkItems("blockers", output.blockers, fixture.blockers, failures);
  } catch (error) {
    failures.push(`schema: ${error instanceof Error ? error.message : String(error)}`);
  }
  return failures;
}

function checkItems(field: string, items: string[], supported: RegExp[], failures: string[]) {
  for (const item of items) {
    if (!supported.some((pattern) => pattern.test(item))) failures.push(`${field}: unsupported item ${JSON.stringify(item)}`);
  }
  for (const pattern of supported) {
    if (!items.some((item) => pattern.test(item))) failures.push(`${field}: missing source-supported item matching ${pattern}`);
  }
}
