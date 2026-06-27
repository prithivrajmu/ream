export type ThemeId = "old-money" | "retro-console" | "indian-miniature" | "manga-ink" | "dark-studio" | "color-blind";

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
  swatches: string[];
}

export const THEME_STORAGE_KEY = "ream-theme";

export const DEFAULT_THEME_ID: ThemeId = "old-money";

export const themeOptions: ThemeOption[] = [
  {
    id: "old-money",
    label: "Classic old money",
    description: "Ivory, deep green, oxblood, and brass for a quiet desk-calendar feel.",
    swatches: ["#f8f6ef", "#20382e", "#7a2f2a", "#b28a4a"]
  },
  {
    id: "retro-console",
    label: "90s console",
    description: "Chunky panels, cartridge reds, saturated blues, and playful yellow status hits.",
    swatches: ["#f7f1d0", "#e9402f", "#2458d7", "#f5c542"]
  },
  {
    id: "indian-miniature",
    label: "Old Indian painting",
    description: "Parchment, indigo, vermillion, and malachite inspired by miniature painting pigments.",
    swatches: ["#f4e3bd", "#153f63", "#b43f2f", "#28744a"]
  },
  {
    id: "manga-ink",
    label: "Manga ink",
    description: "Paper white, black ink, screentone texture, and a sharp red action accent.",
    swatches: ["#f8f8f1", "#111111", "#d8d8cf", "#d52f35"]
  },
  {
    id: "dark-studio",
    label: "Dark studio",
    description: "Low-glare charcoal with teal and amber cues for late work sessions.",
    swatches: ["#111820", "#1f2933", "#2ec4b6", "#ffb347"]
  },
  {
    id: "color-blind",
    label: "Color-blind friendly",
    description: "High-contrast neutrals with blue, orange, and sky accents chosen to avoid red/green dependence.",
    swatches: ["#f7f7f5", "#0072b2", "#e69f00", "#56b4e9"]
  }
];

export function isThemeId(value: string | null): value is ThemeId {
  return themeOptions.some((theme) => theme.id === value);
}

export function readStoredTheme(storage: Pick<Storage, "getItem"> = window.localStorage): ThemeId {
  try {
    const storedTheme = storage.getItem(THEME_STORAGE_KEY);
    return isThemeId(storedTheme) ? storedTheme : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function persistTheme(storage: Pick<Storage, "setItem">, themeId: ThemeId): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // Theme persistence is non-critical; keep the selected theme for this session.
  }
}
