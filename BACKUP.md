# Private Backup

Timesheet Tracker stores work locally in IndexedDB. Use JSON export as the restore format and CSV export for reporting.

## Manual private GitHub backup

1. Export JSON from the app.
2. Move or copy the exported file into `backups/`.
3. Commit the backup file to a private GitHub repository.
4. Restore later with Import JSON in the app.

Suggested file name:

```text
backups/timesheet-export-YYYY-MM-DD.json
```

Keep the repository private because exports include task names, notes, timestamps, and project/client labels.
