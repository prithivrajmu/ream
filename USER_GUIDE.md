# Ream User Guide

Ream is a local-first desktop app for tracking tasks, time, and notes. This guide covers the app as it works today — every behavior below reflects the current shipped build, not planned features (see [FUTURE_IMPROVEMENTS.md](FUTURE_IMPROVEMENTS.md) for what's next).

All of your data — tasks, projects, time entries, and notes — is stored locally on your machine. Nothing is sent to a server unless you explicitly export a backup or opt into local AI note improvement (which talks to a local Ollama instance on your machine, never the cloud).

## Getting Started

See the [README](README.md#install) for install options (Homebrew, APT, or running from source). On first launch, Ream creates a local database in your OS's default app data folder — you can change this later from Settings.

## The Main Window

The sidebar is split into two groups:

**Workspace**
- **Home** — your task list with quick-start controls and the active timer banner.
- **Entries** — a log of recent completed time entries. Each entry can be edited (task, start/end time, note) or deleted.
- **Tasks** — full task list, including archived tasks. Archive, unarchive, or permanently delete archived tasks here.
- **Notes** — every time entry that has a note attached, with AI note improvement available per note.
- **Projects** — create, rename, archive, and unarchive projects. Projects cannot be permanently deleted from the UI (only archived).

**Utilities**
- **Insights** — totals, daily average, focus ratio, a stacked time-by-task chart, task/project rankings, session history, highlights (best day, longest focus block, top task), and a time-of-day heatmap. Use the Previous/Next buttons to move between weeks.
- **Timesheet** — a weekly grid of tasks × days with per-cell duration, per-task and per-day totals, and a grand total. Also supports Previous/Next week navigation.
- **Settings** — labeled "Settings" in the sidebar; this is where backups, data location, and the local AI setup live (details below).
- **AI Stats** — metrics on AI note-improvement requests: average response time, and counts of accepted/rejected/copied/pending suggestions, plus a list of improved notes.

Click your name/avatar at the bottom of the sidebar to open **Profile**, where you can set your display name, pick a theme, choose the overlay's resting size (Mini/Tiny), adjust overlay transparency, and see your all-time tracked totals.

### Creating a task

Use the task composer to set a name (required), optionally attach it to one or more projects, add comma-separated tags, and give it a starting note. Projects are created separately with just a name.

### Tracking time

Click a task's play button to start its timer — this also opens the compact overlay. While a timer runs, the Home view shows an elapsed-time banner with an inline note field that saves automatically when you click away. Click "Stop timer" to end the session and create a completed time entry.

To fix a mistake or log time after the fact, go to **Entries** and use "New Entry" or "Edit" on an existing entry to set the task, start/end time, and note directly.

### Notes and AI improvement

Any note — on an active timer or a saved entry — can be improved with local AI (if you've set it up in Settings). Click "Improve with AI" to get a cleaned-up version alongside a summary, next steps, blockers, and suggested tags. Your original note is never changed automatically:

- **Accept** replaces the note with the AI version (the original is kept in the AI request record).
- **Copy suggestion** copies the cleaned text to your clipboard without changing the saved note.
- **Reject** discards the suggestion.

### Archiving and deleting

- **Tasks**: Archive a task to move it out of the active list (you can't archive a task while its timer is running). Archived tasks can be unarchived or permanently deleted — deleting a task does not delete its past time entries, which remain visible and labeled as belonging to an archived task.
- **Projects**: Archive or unarchive only — there is no permanent delete for projects.
- **Time entries**: Deletable directly from the Entries list, with a confirmation prompt.

### Backups (Settings → Settings)

- **Export JSON** downloads a full backup (`ream-export-YYYY-MM-DD.json`) — this is the only supported restore format.
- **Export CSV** downloads a report-only file (`ream-export-YYYY-MM-DD.csv`) with one row per time entry — CSV is for spreadsheets, not for restoring into Ream.
- **Import JSON** **replaces all local data** with the contents of the file — it does not merge. You'll get a confirmation prompt before this happens. See [BACKUP.md](BACKUP.md) for a suggested private-backup workflow.
- **Change folder** moves where Ream stores its local database, copying your existing data to the new location and relaunching against it.

### Local AI setup

In Settings, enable "AI note improvement," set the Ollama model name (defaults to a small model), and use "Check" to confirm Ream can reach your local Ollama install. "Install Ollama" and "Pull model" open the relevant download/library pages in your browser. Ream works normally with Ollama absent — you just won't see the "Improve with AI" option until it's reachable.

## The Overlay

The overlay is a small, frameless, always-on-top window for tracking time without switching away from what you're doing (a call, browser, or editor).

**Opening it**: press `Cmd/Ctrl+Shift+T`, click the tray icon, choose "Show Overlay" from the tray or app menu, or click a task's play button in the main window.

**Sizes**: the overlay has a full **expanded** panel and a compact **tiny** bar. It auto-collapses to tiny after a few seconds of inactivity. Right-click the tiny bar for a menu with "Expand to mini," "Expand to default," Pause/Resume, "End session," and "Settings." Press `Escape` to collapse back to tiny.

**In the expanded panel** you can switch tasks, start/pause/resume/stop the timer, tap project-tag chips to append a `#tag` to your note, write and expand a notes field, and run the same AI note improvement (Accept/Copy/Reject) as the main window. Pressing `Space` also pauses/resumes the timer as long as you're not typing in a text field. Stopping a timer that's run 10+ seconds asks for confirmation first.

**Staying on top**: the overlay stays pinned above other windows by default and shows on all your desktop spaces, including over full-screen apps.

## Tray and menu bar

- **Tray icon**: left-click toggles the overlay; right-click gives you "Show Main Window," "Show Overlay," and "Quit."
- **App menu**: standard Edit menu (undo/redo/cut/copy/paste), a "Ream" menu (Show Main Window, Show Overlay, Quit), and a View menu (reload, dev tools, zoom) — useful mainly for troubleshooting.

## Themes

Pick from six themes in Profile: Classic old money (default), 90s console, Old Indian painting, Manga ink, Dark studio, and Color-blind friendly. Your choice is saved locally and applies across the main window.

## Keeping your data safe

Exports contain everything you've tracked — task names, notes, project labels, and timestamps. Treat exported files as private, the same way you'd treat a personal journal, and don't commit them to a public repository. See [BACKUP.md](BACKUP.md) for a private-backup pattern using a personal GitHub repo.
