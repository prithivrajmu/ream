import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY, isThemeId, persistTheme, readStoredTheme, themeOptions } from "../renderer/themeOptions";

describe("theme options", () => {
  it("keeps the requested exploration directions available", () => {
    expect(themeOptions.map((theme) => theme.id)).toEqual([
      "old-money",
      "retro-console",
      "indian-miniature",
      "manga-ink",
      "dark-studio",
      "color-blind"
    ]);
  });

  it("reads a valid locally stored theme", () => {
    expect(readStoredTheme({ getItem: () => "manga-ink" })).toBe("manga-ink");
  });

  it("falls back to the default when storage is empty, invalid, or unavailable", () => {
    expect(readStoredTheme({ getItem: () => null })).toBe(DEFAULT_THEME_ID);
    expect(readStoredTheme({ getItem: () => "red-green" })).toBe(DEFAULT_THEME_ID);
    expect(readStoredTheme({ getItem: () => { throw new Error("blocked"); } })).toBe(DEFAULT_THEME_ID);
  });

  it("persists selected themes without surfacing storage errors", () => {
    const setItem = vi.fn();
    persistTheme({ setItem }, "dark-studio");
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "dark-studio");

    expect(() => persistTheme({ setItem: () => { throw new Error("blocked"); } }, "color-blind")).not.toThrow();
  });

  it("rejects unknown theme ids", () => {
    expect(isThemeId("retro-console")).toBe(true);
    expect(isThemeId("unknown")).toBe(false);
  });
});
