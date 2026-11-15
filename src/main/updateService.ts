import { app, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { selectAppUpdate, type GithubRelease, type UpdateCandidate } from "../shared/appUpdates";

const RELEASES_URL = "https://api.github.com/repos/prithivrajmu/ream/releases?per_page=30";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const START_DELAY_MS = 8000;

interface UpdateSettings {
  autoUpdate: boolean;
}

export interface UpdateMenuState {
  label: string;
  enabled: boolean;
  autoUpdate: boolean;
  busy: boolean;
}

interface UpdateServiceOptions {
  settingsPath: string;
  downloadDirectory: string;
  onChange: () => void;
}

export function createUpdateService(options: UpdateServiceOptions) {
  const settings = readSettings(options.settingsPath);
  let phase: "idle" | "checking" | "downloading" | "ready" = "idle";
  let available: UpdateCandidate | null = null;
  let downloadedPath: string | null = null;
  let promptedVersion = "";
  let run: Promise<void> | null = null;
  let startTimer: NodeJS.Timeout | undefined;
  let intervalTimer: NodeJS.Timeout | undefined;

  function publish() {
    options.onChange();
  }

  function menuState(): UpdateMenuState {
    if (phase === "checking") return { label: "Checking for Updates…", enabled: false, autoUpdate: settings.autoUpdate, busy: true };
    if (phase === "downloading") return { label: "Downloading Update…", enabled: false, autoUpdate: settings.autoUpdate, busy: true };
    if (phase === "ready" && available) return { label: `Install Update ${available.version}`, enabled: true, autoUpdate: settings.autoUpdate, busy: false };
    if (available) return { label: `Download Update ${available.version}`, enabled: true, autoUpdate: settings.autoUpdate, busy: false };
    return { label: "Check for Updates", enabled: true, autoUpdate: settings.autoUpdate, busy: false };
  }

  function setAutoUpdate(enabled: boolean) {
    settings.autoUpdate = enabled;
    writeSettings(options.settingsPath, settings);
    publish();
    if (enabled) void checkForUpdates(false);
  }

  function checkForUpdates(manual: boolean): Promise<void> {
    if (run) return run;
    run = perform(manual).finally(() => {
      run = null;
    });
    return run;
  }

  async function perform(manual: boolean) {
    if (!app.isPackaged) {
      if (manual) {
        await dialog.showMessageBox({
          type: "info",
          message: "Updates run in the installed app.",
          detail: "This development build stays on the source version. Install a Ream release to check for updates."
        });
      }
      return;
    }

    if (phase === "ready" && available && downloadedPath && manual) {
      await promptInstall();
      return;
    }

    phase = "checking";
    publish();
    try {
      const candidate = selectAppUpdate(await fetchReleases(), app.getVersion(), process.platform, process.arch);
      available = candidate;
      if (!candidate) {
        downloadedPath = null;
        phase = "idle";
        publish();
        if (manual) {
          await dialog.showMessageBox({
            type: "info",
            message: "Ream is up to date.",
            detail: `You are running ${app.getVersion()}.`
          });
        }
        return;
      }

      if (downloadedPath && existsSync(downloadedPath) && downloadedPath.includes(candidate.version)) {
        phase = "ready";
        publish();
        if (manual || (settings.autoUpdate && promptedVersion !== candidate.version)) {
          promptedVersion = candidate.version;
          await promptInstall();
        }
        return;
      }

      downloadedPath = null;
      phase = "idle";
      publish();
      if (!manual && !settings.autoUpdate) return;
      await download(candidate);
      if (manual || promptedVersion !== candidate.version) {
        promptedVersion = candidate.version;
        await promptInstall();
      }
    } catch (error) {
      phase = available && downloadedPath ? "ready" : "idle";
      publish();
      if (manual) {
        await dialog.showMessageBox({
          type: "warning",
          message: "Ream could not check for updates.",
          detail: error instanceof Error ? error.message : "The update server did not respond."
        });
      }
    }
  }

  async function download(candidate: UpdateCandidate) {
    phase = "downloading";
    available = candidate;
    publish();
    mkdirSync(options.downloadDirectory, { recursive: true });
    const destination = join(options.downloadDirectory, candidate.assetName);
    const response = await fetch(candidate.url, { headers: { "User-Agent": "Ream" } });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination));
    downloadedPath = destination;
    phase = "ready";
    publish();
  }

  async function promptInstall() {
    if (!available || !downloadedPath) return;
    const choice = await dialog.showMessageBox({
      type: "info",
      buttons: process.platform === "darwin" ? ["Open installer", "Later"] : ["Install and restart", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `Ream ${available.version} is ready`,
      detail: process.platform === "darwin"
        ? "Open the disk image, then drag Ream into Applications. This build is not replaced while it is open."
        : "Ream will replace this copy and restart."
    });
    if (choice.response !== 0) return;
    try {
      await install(downloadedPath);
    } catch (error) {
      await dialog.showMessageBox({
        type: "warning",
        message: "Ream could not open the update.",
        detail: error instanceof Error ? error.message : "Open the downloaded file from the updates folder."
      });
    }
  }

  function start() {
    stop();
    if (!app.isPackaged) return;
    startTimer = setTimeout(() => {
      if (settings.autoUpdate) void checkForUpdates(false);
    }, START_DELAY_MS);
    intervalTimer = setInterval(() => {
      if (settings.autoUpdate && phase !== "downloading") void checkForUpdates(false);
    }, CHECK_INTERVAL_MS);
  }

  function stop() {
    clearTimeout(startTimer);
    clearInterval(intervalTimer);
    startTimer = undefined;
    intervalTimer = undefined;
  }

  return { menuState, setAutoUpdate, checkForUpdates, start, stop };
}

async function fetchReleases(): Promise<GithubRelease[]> {
  const response = await fetch(RELEASES_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Ream" }
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("GitHub did not return a release list.");
  return payload.filter(isRelease);
}

function isRelease(value: unknown): value is GithubRelease {
  if (!value || typeof value !== "object") return false;
  const release = value as GithubRelease;
  return typeof release.tag_name === "string" && (release.assets === undefined || Array.isArray(release.assets));
}

async function install(filePath: string) {
  const current = process.env.APPIMAGE;
  if (process.platform === "linux" && current) {
    try {
      chmodSync(filePath, 0o755);
      const backup = `${current}.previous`;
      renameSync(current, backup);
      renameSync(filePath, current);
      spawn(current, [], { detached: true, stdio: "ignore" }).unref();
      app.quit();
      return;
    } catch {
      const openError = await shell.openPath(filePath);
      if (openError) throw new Error(openError);
      return;
    }
  }
  const openError = await shell.openPath(filePath);
  if (openError) throw new Error(openError);
}

function readSettings(path: string): UpdateSettings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && "autoUpdate" in parsed && typeof parsed.autoUpdate === "boolean") {
      return { autoUpdate: parsed.autoUpdate };
    }
  } catch {
    // Missing or unreadable settings use the default.
  }
  return { autoUpdate: true };
}

function writeSettings(path: string, settings: UpdateSettings) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings));
}
