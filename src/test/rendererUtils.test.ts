import { describe, expect, it } from "vitest";
import { formatEntryDateTime } from "../renderer/rendererUtils";

describe("renderer utilities", () => {
  it("formats an entry date and time without invalid Intl options", () => {
    expect(() => formatEntryDateTime("2026-06-25T09:30:00.000Z")).not.toThrow();
    expect(formatEntryDateTime("2026-06-25T09:30:00.000Z")).not.toBe("");
  });
});
