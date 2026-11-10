import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LiveAiNotePreview } from "../renderer/notes/LiveAiNotePreview";

const props = {
  rawNote: "Original", output: { clean_note: "Cleaned", summary: "Summary", next_steps: [], blockers: [], tags: [] },
  model: "synthetic", localNote: "Original", savedNote: "Original", sessionChanged: false, busy: false,
  onAccept: () => {}, onCopy: () => {}, onReject: () => {}, onRegenerate: () => {}
};
describe("live AI preview controls", () => {
  it("requires review when local or saved text changes, without hiding the suggestion", () => {
    const html = renderToStaticMarkup(createElement(LiveAiNotePreview, { ...props, localNote: "<script>Local edit</script>", savedNote: "Remote edit" }));
    expect(html).toContain("&lt;script&gt;Local edit&lt;/script&gt;");
    expect(html).toContain("Remote edit");
    expect(html).toContain("Original source note");
    expect(html).toContain('disabled="" type="button">Accept');
    expect(html).toContain('type="button">Regenerate from current note');
  });
  it("disables all four actions while an operation is pending", () => {
    const html = renderToStaticMarkup(createElement(LiveAiNotePreview, { ...props, localNote: "New draft", busy: true }));
    expect(html.match(/disabled=""/g)).toHaveLength(4);
    expect(html).toContain("You can keep editing");
  });
  it.each(["empty", "session"])("does not offer regeneration for an %s preview", (kind) => {
    const html = renderToStaticMarkup(createElement(LiveAiNotePreview, { ...props, localNote: kind === "empty" ? "" : "Original", sessionChanged: kind === "session" }));
    expect(html).not.toContain('type="button">Regenerate');
    expect(html).toContain('disabled="" type="button">Accept');
  });
});
