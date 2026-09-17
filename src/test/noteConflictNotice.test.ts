import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NoteConflictNotice } from "../renderer/notes/NoteConflictNotice";

describe("conflict notice", () => {
  it("shows both versions as plain text and explains all resolution choices", () => {
    const html = renderToStaticMarkup(createElement(NoteConflictNotice, {
      localValue: "<script>untrusted note text</script>", savedValue: "Saved text", onResolve: vi.fn()
    }));
    expect(html).toContain('aria-label="Resolve note conflict"');
    expect(html).toContain("&lt;script&gt;untrusted note text&lt;/script&gt;");
    expect(html).toContain("Saved text");
    expect(html).toContain("Keep both versions");
    expect(html).toContain("Use saved version");
    expect(html).toContain("Save my version");
    expect(html).toContain("discards your edit");
  });

  it("renders no notice without a conflict but distinguishes an empty saved note", () => {
    expect(renderToStaticMarkup(createElement(NoteConflictNotice, { localValue: "Draft", savedValue: null, onResolve: vi.fn() }))).toBe("");
    expect(renderToStaticMarkup(createElement(NoteConflictNotice, { localValue: "Draft", savedValue: "", onResolve: vi.fn() }))).toContain("(Empty note)");
  });
});
