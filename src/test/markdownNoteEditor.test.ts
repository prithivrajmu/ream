import { DEFAULT_TRANSFORMERS } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { createEditor } from "lexical";
import { describe, expect, it } from "vitest";

function roundTripMarkdown(markdown: string): string {
  const editor = createEditor({
    namespace: "MarkdownNoteEditorTest",
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, CodeNode, CodeHighlightNode, HorizontalRuleNode],
    onError(error) {
      throw error;
    }
  });
  let output = "";

  editor.update(() => {
    $convertFromMarkdownString(markdown, DEFAULT_TRANSFORMERS, undefined, true);
    output = $convertToMarkdownString(DEFAULT_TRANSFORMERS, undefined, true);
  }, { discrete: true });

  return output.trim();
}

describe("Markdown note editor conversion", () => {
  it("keeps common text formatting as Markdown", () => {
    const output = roundTripMarkdown("# Plan\n\n**bold** *soft* ~~done~~ `code` [docs](https://example.com)");

    expect(output).toContain("# Plan");
    expect(output).toContain("**bold** *soft* ~~done~~ `code` [docs](https://example.com)");
  });

  it("keeps nested lists and checklists as Markdown", () => {
    const output = roundTripMarkdown("- Parent\n  - Child\n- [x] Done\n- [ ] Pending");

    expect(output).toContain("- Parent");
    expect(output).toContain("- Child");
    expect(output).toContain("- [x] Done");
    expect(output).toContain("- [ ] Pending");
  });

  it("keeps content blocks as Markdown", () => {
    const output = roundTripMarkdown("> Quote\n\n---\n\n```ts\nconst ok = true;\n```");

    expect(output).toContain("> Quote");
    expect(output).toContain("***");
    expect(output).toContain("```ts\nconst ok = true;\n```");
  });
});
