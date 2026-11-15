import { execFile } from "node:child_process";
import { powerMonitor } from "electron";
import { parseActivityListing, type ActivitySample } from "../shared/activityTracking";

export const ACTIVITY_SAMPLE_INTERVAL_MS = 5000;

const ACTIVITY_APPLESCRIPT = `
set unit to ASCII character 31
set output to ""

tell application "System Events"
  set frontProc to first application process whose frontmost is true
  set frontName to name of frontProc
  set frontTitle to ""
  try
    set frontTitle to name of front window of frontProc
  end try
end tell
set output to output & "F" & unit & my flatten(frontName) & unit & my flatten(frontTitle) & linefeed

set namesToRead to {"Microsoft Teams", "Teams", "MSTeams", "Slack"}
if frontName is not in namesToRead then set end of namesToRead to frontName

repeat with procName in namesToRead
  set procTitle to ""
  set titles to {}
  tell application "System Events"
    if exists process (procName as text) then
      set procTitle to name of process (procName as text)
      try
        set titles to name of every window of process (procName as text)
      end try
    end if
  end tell
  if procTitle is not "" then
    if class of titles is not list then set titles to {titles}
    repeat with windowTitle in titles
      try
        set output to output & "W" & unit & my flatten(procTitle) & unit & my flatten(windowTitle as text) & linefeed
      end try
    end repeat
  end if
end repeat

return output

on flatten(value)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to {return, linefeed, tab, ASCII character 31}
  set parts to text items of (value as text)
  set AppleScript's text item delimiters to " "
  set flattened to parts as text
  set AppleScript's text item delimiters to oldDelims
  return flattened
end flatten
`;

export function createActivityWatcher(emit: (sample: ActivitySample) => void) {
  let timer: NodeJS.Timeout | null = null;
  let enabled = false;
  let sampling = false;

  async function tick() {
    if (sampling) return;
    sampling = true;
    try {
      emit(await captureActivitySample());
    } finally {
      sampling = false;
    }
  }

  return {
    isEnabled() {
      return enabled;
    },
    setEnabled(next: boolean) {
      enabled = next;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (!enabled) return;
      void tick();
      timer = setInterval(() => void tick(), ACTIVITY_SAMPLE_INTERVAL_MS);
    },
    sampleOnce() {
      return captureActivitySample();
    },
    stop() {
      this.setEnabled(false);
    }
  };
}

export async function captureActivitySample(now = new Date()): Promise<ActivitySample> {
  const capturedAt = now.toISOString();
  const idleSeconds = readIdleSeconds();
  if (process.platform !== "darwin") {
    return {
      capturedAt,
      idleSeconds,
      frontmost: null,
      windows: [],
      permissionError: "Automatic tracking reads app windows on macOS."
    };
  }

  try {
    const stdout = await runOsascript(ACTIVITY_APPLESCRIPT);
    const listing = parseActivityListing(stdout);
    return { capturedAt, idleSeconds, frontmost: listing.frontmost, windows: listing.windows, permissionError: "" };
  } catch (error) {
    return { capturedAt, idleSeconds, frontmost: null, windows: [], permissionError: permissionMessage(error) };
  }
}

function readIdleSeconds(): number {
  try {
    return Math.max(0, Math.floor(powerMonitor.getSystemIdleTime()));
  } catch {
    return 0;
  }
}

function runOsascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("/usr/bin/osascript", ["-"], { timeout: 4000, maxBuffer: 1_048_576 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
    child.stdin?.end(script);
  });
}

function permissionMessage(error: unknown): string {
  const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
  const message = error instanceof Error ? error.message : "";
  const text = `${message}\n${stderr}`;
  if (/(-1743|1002|not authorized|assistive|Accessibility|-25211)/i.test(text)) {
    return "Ream needs Accessibility access to read the frontmost app. Enable Ream in System Settings, Privacy & Security, Accessibility, then try again.";
  }
  return "Ream could not read the frontmost app.";
}
