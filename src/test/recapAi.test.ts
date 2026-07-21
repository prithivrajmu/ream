import { describe, expect, it } from "vitest";
import { formatGeneratedRecapMarkdown, validateGeneratedRecapOutput } from "../shared/ai";

describe("recap AI contracts", () => {
  it("validates recap JSON and renders unchecked todos", () => {
    const output = validateGeneratedRecapOutput({ summary: "A focused day.", todos: ["Send the draft", "Review feedback"] });
    expect(formatGeneratedRecapMarkdown(output, "Jul 10, 2026")).toContain("- [ ] Send the draft");
    expect(formatGeneratedRecapMarkdown(output, "Jul 10, 2026")).toContain("### Summary");
  });

  it("rejects malformed recap output and handles no todos", () => {
    expect(() => validateGeneratedRecapOutput({ summary: "Okay", todos: "none" })).toThrow("todos");
    expect(formatGeneratedRecapMarkdown({ summary: "Quiet day.", todos: [] }, "Yesterday")).toContain("No explicit todos found");
  });
});
