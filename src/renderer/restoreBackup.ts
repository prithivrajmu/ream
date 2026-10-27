import type { ReamDatabase } from "../shared/db";
import { importReamData } from "../shared/exportRepository";
import { parseReamExport } from "../shared/reporting";
import { getActiveTimer } from "../shared/timerRepository";

export async function restoreBackup(database: ReamDatabase, text: string, actions: {
  confirmRestore: (message: string) => boolean;
  flushPendingNotes: () => Promise<unknown>;
}): Promise<boolean> {
  const exportData = parseReamExport(text);
  if (await getActiveTimer(database)) {
    throw new Error("Stop the active timer before importing a backup so its time and note can be saved. Export a JSON copy first if you want to keep the current workspace.");
  }
  const confirmed = actions.confirmRestore(
    `Replace this workspace with ${exportData.tasks.length} tasks, ${exportData.timeEntries.length} time entries, ${exportData.journalPages.length} journal pages, and ${exportData.journalRecaps.length} recaps? All current tasks, projects, entries, journal notes, and AI suggestions will be replaced, including recent edits. Export a JSON copy first to keep them. This cannot be undone.`
  );
  if (!confirmed) return false;
  // Failed pending saves abort the restore and retain recovery drafts.
  await actions.flushPendingNotes();
  await importReamData(database, exportData);
  return true;
}
