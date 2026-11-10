# Ream Private Backup

Ream stores work locally in IndexedDB. Use JSON export as the restore format and CSV export for reporting.

JSON includes tasks, projects, saved time entries, journal pages, and journal recaps. It does not include an active timer, app settings, or AI note suggestions. Stop your timer before exporting to include that session and its note.

Import replaces the current workspace; it does not merge records. Export a copy first if you want to keep the current data. A running or paused timer must be stopped before importing. Pending note saves are flushed before replacement; if saving or importing fails, existing data and recovery drafts remain available. Successful restores isolate old journal drafts and queued saves so they cannot overwrite imported notes.

## Recover unsaved notes

Open **Settings → Recover unsaved notes** to find locally retained drafts, including notes left behind when a timer ends in another window. Search by date or text, review the original saved version, then copy the draft or download a Markdown file and paste the text into the appropriate note. These actions do not overwrite saved entries or delete the recovery copy. Empty drafts represent an intentional attempt to clear a note.

Recovery drafts are separate from JSON backups and depend on the app's local browser storage; they are not a substitute for backups. Downloaded recovery files may contain private notes—handle them like your other exports.

## Manual private GitHub backup

1. Export JSON from the app.
2. Move or copy the exported file into `backups/`.
3. Commit the backup file to a private GitHub repository.
4. Restore later with Import JSON in the app.

Suggested file name:

```text
backups/ream-export-YYYY-MM-DD.json
```

Keep the repository private because exports include task names, notes, timestamps, and project/client labels.
