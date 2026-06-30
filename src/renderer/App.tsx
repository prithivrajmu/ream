import { useEffect, useState } from "react";
import { APP_SETTINGS_STORAGE_KEY, readAppSettings, persistAppSettings, type AppSettings } from "./appSettings";
import { migrateLegacyDatabase } from "../shared/db";
import { MainView } from "./views/MainView";
import { OverlayView } from "./views/OverlayView";
import { SetupView } from "./views/SetupView";
import { persistTheme, readStoredTheme, THEME_STORAGE_KEY, type ThemeId } from "./themeOptions";

type Route = "main" | "overlay";

function getRoute(): Route {
  return window.location.hash.includes("overlay") ? "overlay" : "main";
}

export function App() {
  const [route] = useState<Route>(() => getRoute());
  const [themeId, setThemeId] = useState<ThemeId>(() => readStoredTheme());
  const [appSettings, setAppSettings] = useState<AppSettings>(() => readAppSettings(window.localStorage, readStoredTheme()));
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    migrateLegacyDatabase()
      .catch((error: unknown) => {
        console.warn("Unable to migrate legacy Ream database.", error);
      })
      .finally(() => setDataReady(true));
  }, []);

  useEffect(() => {
    const isOverlay = route === "overlay";
    document.documentElement.classList.toggle("overlay-route", isOverlay);
    document.body.classList.toggle("overlay-route", isOverlay);

    return () => {
      document.documentElement.classList.remove("overlay-route");
      document.body.classList.remove("overlay-route");
    };
  }, [route]);

  useEffect(() => {
    persistTheme(window.localStorage, themeId);
  }, [themeId]);

  useEffect(() => {
    persistAppSettings(window.localStorage, appSettings);
  }, [appSettings]);

  useEffect(() => {
    function syncThemeFromStorage() {
      setThemeId(readStoredTheme());
      setAppSettings((currentSettings) => readAppSettings(window.localStorage, currentSettings.themeId));
    }

    function handleStorage(event: StorageEvent) {
      if (!event.key || event.key === THEME_STORAGE_KEY || event.key === APP_SETTINGS_STORAGE_KEY) {
        syncThemeFromStorage();
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        syncThemeFromStorage();
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", syncThemeFromStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", syncThemeFromStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  function updateAppSettings(nextSettings: AppSettings) {
    setAppSettings(nextSettings);
    setThemeId(nextSettings.themeId);
  }

  if (!dataReady) {
    return <main className={`setup-shell theme-${themeId}`}><section className="setup-window setup-loading"><p>Loading Ream...</p></section></main>;
  }

  if (route === "overlay") {
    return <OverlayView overlayTransparency={appSettings.overlayTransparency} themeId={themeId} />;
  }

  if (!appSettings.setupCompletedAt || isSetupOpen) {
    return <SetupView initialSettings={{ ...appSettings, themeId }} onComplete={(nextSettings) => {
      updateAppSettings(nextSettings);
      setIsSetupOpen(false);
    }} onThemeChange={setThemeId} />;
  }

  return <MainView appSettings={{ ...appSettings, themeId }} onAppSettingsChange={updateAppSettings} onOpenSetup={() => setIsSetupOpen(true)} themeId={themeId} />;
}
