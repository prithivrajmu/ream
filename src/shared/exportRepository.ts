import type { ReamDatabase } from "./db";
import type { ReamExport } from "./reporting";
import { readWorkspaceRevision } from "./workspaceRepository";

export async function readAllExportData(database: ReamDatabase): Promise<ReamExport> {
  // A backup must describe one snapshot, not a mix of data before/after a write.
  return database.transaction("r", [database.tasks, database.projects, database.timeEntries, database.journalPages, database.journalRecaps], async () => {
    const [tasks, projects, timeEntries, journalPages, journalRecaps] = await Promise.all([
      database.tasks.toArray(),
      database.projects.toArray(),
      database.timeEntries.toArray(),
      database.journalPages.toArray(),
      database.journalRecaps.toArray()
    ]);

    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: 4,
      tasks,
      projects,
      timeEntries,
      journalPages,
      journalRecaps
    };
  });
}

export async function importReamData(database: ReamDatabase, exportData: ReamExport): Promise<void> {
  await database.transaction("rw", [database.tasks, database.projects, database.timeEntries, database.activeTimers, database.noteAiSuggestions, database.journalPages, database.journalRecaps, database.workspaceState], async () => {
    if (await database.activeTimers.count()) {
      throw new Error("Stop the active timer before importing a backup. Its time and note are not included in backup files.");
    }
    const revision = await readWorkspaceRevision(database);
    await database.activeTimers.clear();
    await database.noteAiSuggestions.clear();
    await database.tasks.clear();
    await database.projects.clear();
    await database.timeEntries.clear();
    await database.journalRecaps.clear();
    await database.journalPages.clear();
    await database.tasks.bulkPut(exportData.tasks);
    await database.projects.bulkPut(exportData.projects);
    await database.timeEntries.bulkPut(exportData.timeEntries);
    await database.journalPages.bulkPut(exportData.journalPages);
    await database.journalRecaps.bulkPut(exportData.journalRecaps);
    await database.workspaceState.put({ id: "restore", revision: revision + 1 });
  });
}
