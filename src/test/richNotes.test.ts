import { describe, expect, it } from "vitest";
import { parseRichNote } from "../renderer/richNotes";

describe("rich notes parser", () => {
  it("parses fenced code blocks", () => {
    expect(parseRichNote("```ts\nconst ok = true;\n```")).toEqual([
      { type: "code", language: "ts", code: "const ok = true;" }
    ]);
  });

  it("parses nested unordered lists", () => {
    const blocks = parseRichNote("- Parent\n  - Child");

    expect(blocks[0]).toMatchObject({
      type: "list",
      ordered: false,
      items: [
        {
          content: [{ type: "text", text: "Parent" }],
          children: [
            {
              type: "list",
              ordered: false,
              items: [{ content: [{ type: "text", text: "Child" }] }]
            }
          ]
        }
      ]
    });
  });

  it("parses regular links inside paragraphs", () => {
    expect(parseRichNote("See https://example.com/docs today.")).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          { type: "link", href: "https://example.com/docs", content: [{ type: "text", text: "https://example.com/docs" }] },
          { type: "text", text: " today." }
        ]
      }
    ]);
  });

  it("parses direct video links and safe video embeds", () => {
    expect(parseRichNote("https://example.com/demo.mp4\nhttps://youtu.be/abc123")).toEqual([
      { type: "video", src: "https://example.com/demo.mp4" },
      {
        type: "embed",
        provider: "youtube",
        src: "https://www.youtube-nocookie.com/embed/abc123",
        href: "https://youtu.be/abc123",
        title: "YouTube video"
      }
    ]);
  });

  it("parses common markdown enrichments", () => {
    expect(parseRichNote("# Title\n\n> Quote\n\n---\n\n**bold** *soft* ~~done~~ `code` [docs](https://example.com)")).toEqual([
      { type: "heading", level: 1, content: [{ type: "text", text: "Title" }] },
      { type: "blockquote", blocks: [{ type: "paragraph", content: [{ type: "text", text: "Quote" }] }] },
      { type: "rule" },
      {
        type: "paragraph",
        content: [
          { type: "strong", content: [{ type: "text", text: "bold" }] },
          { type: "text", text: " " },
          { type: "emphasis", content: [{ type: "text", text: "soft" }] },
          { type: "text", text: " " },
          { type: "strike", content: [{ type: "text", text: "done" }] },
          { type: "text", text: " " },
          { type: "inlineCode", code: "code" },
          { type: "text", text: " " },
          { type: "link", href: "https://example.com", content: [{ type: "text", text: "docs" }] }
        ]
      }
    ]);
  });

  it("parses task lists and markdown tables", () => {
    expect(parseRichNote("- [x] Ship\n- [ ] Polish\n\n| A | B |\n| --- | --- |\n| 1 | **two** |")).toMatchObject([
      {
        type: "list",
        items: [
          { checked: true, content: [{ type: "text", text: "Ship" }] },
          { checked: false, content: [{ type: "text", text: "Polish" }] }
        ]
      },
      {
        type: "table",
        headers: [[{ type: "text", text: "A" }], [{ type: "text", text: "B" }]],
        rows: [[[ { type: "text", text: "1" } ], [{ type: "strong", content: [{ type: "text", text: "two" }] }]]]
      }
    ]);
  });

  it("keeps unsupported HTML as paragraph text", () => {
    expect(parseRichNote("<img src=x onerror=alert(1)>")).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] }
    ]);
  });
});
