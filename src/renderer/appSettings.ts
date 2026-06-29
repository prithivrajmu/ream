import { DEFAULT_OLLAMA_MODEL } from "../shared/ai";
import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "./themeOptions";

export const APP_SETTINGS_STORAGE_KEY = "ream.appSettings.v1";

export type AiSetupPreference = "skipped" | "enabled";

export interface AppSettings {
  userName: string;
  setupCompletedAt: string | null;
  themeId: ThemeId;
  overlayTransparency: number;
  aiSetupPreference: AiSetupPreference;
  ollamaModel: string;
}

export const DEFAULT_OVERLAY_TRANSPARENCY = 0.92;

export function createDefaultAppSettings(themeId: ThemeId = DEFAULT_THEME_ID): AppSettings {
  return {
    userName: "",
    setupCompletedAt: null,
    themeId,
    overlayTransparency: DEFAULT_OVERLAY_TRANSPARENCY,
    aiSetupPreference: "skipped",
    ollamaModel: DEFAULT_OLLAMA_MODEL
  };
}

export function readAppSettings(storage: Pick<Storage, "getItem"> = window.localStorage, themeId = DEFAULT_THEME_ID): AppSettings {
  const defaults = createDefaultAppSettings(themeId);

  try {
    const raw = storage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return normalizeAppSettings(parsed, defaults);
  } catch {
    return defaults;
  }
}

export function persistAppSettings(storage: Pick<Storage, "setItem">, settings: AppSettings): void {
  storage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function completeAppSettings(settings: AppSettings, now = new Date()): AppSettings {
  return {
    ...settings,
    userName: settings.userName.trim(),
    setupCompletedAt: settings.setupCompletedAt ?? now.toISOString()
  };
}

function normalizeAppSettings(candidate: Partial<AppSettings>, defaults: AppSettings): AppSettings {
  const overlayTransparency = typeof candidate.overlayTransparency === "number"
    ? clampOverlayTransparency(candidate.overlayTransparency)
    : defaults.overlayTransparency;
  const themeId = typeof candidate.themeId === "string" && isThemeId(candidate.themeId) ? candidate.themeId : defaults.themeId;

  return {
    userName: typeof candidate.userName === "string" ? candidate.userName.trim() : defaults.userName,
    setupCompletedAt: typeof candidate.setupCompletedAt === "string" ? candidate.setupCompletedAt : null,
    themeId,
    overlayTransparency,
    aiSetupPreference: candidate.aiSetupPreference === "enabled" ? "enabled" : "skipped",
    ollamaModel: typeof candidate.ollamaModel === "string" && candidate.ollamaModel.trim()
      ? candidate.ollamaModel.trim()
      : defaults.ollamaModel
  };
}

function clampOverlayTransparency(value: number): number {
  return Math.min(1, Math.max(0.5, value));
}
