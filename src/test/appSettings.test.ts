import { describe, expect, it } from "vitest";
import { completeAppSettings, createDefaultAppSettings, readAppSettings } from "../renderer/appSettings";

function createStorage(value: string | null) {
  return {
    getItem: () => value
  };
}

describe("app settings", () => {
  it("uses defaults when no settings are stored", () => {
    expect(readAppSettings(createStorage(null))).toMatchObject({
      userName: "",
      setupCompletedAt: null,
      themeId: "old-money",
      overlayTransparency: 0.92,
      aiSetupPreference: "skipped"
    });
  });

  it("normalizes stored settings", () => {
    const settings = readAppSettings(createStorage(JSON.stringify({
      userName: "  Prithiv  ",
      setupCompletedAt: "2026-06-29T00:00:00.000Z",
      themeId: "retro-console",
      overlayTransparency: 0.1,
      aiSetupPreference: "enabled",
      ollamaModel: " llama3.2:3b "
    })));

    expect(settings).toMatchObject({
      userName: "Prithiv",
      setupCompletedAt: "2026-06-29T00:00:00.000Z",
      themeId: "retro-console",
      overlayTransparency: 0.5,
      aiSetupPreference: "enabled",
      ollamaModel: "llama3.2:3b"
    });
  });

  it("marks setup complete without changing an existing completion timestamp", () => {
    const settings = completeAppSettings({
      ...createDefaultAppSettings(),
      userName: "  Ream User  ",
      setupCompletedAt: "2026-01-01T00:00:00.000Z"
    }, new Date("2026-06-29T00:00:00.000Z"));

    expect(settings.userName).toBe("Ream User");
    expect(settings.setupCompletedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
