import type { ReamDatabase } from "./db";
import type { ReamExport } from "./reporting";

export async function readAllExportData(database: ReamDatabase): Promise<ReamExport> {
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
}

export async function importReamData(database: ReamDatabase, exportData: ReamExport): Promise<void> {
  await database.transaction("rw", [database.tasks, database.projects, database.timeEntries, database.activeTimers, database.noteAiSuggestions, database.journalPages, database.journalRecaps], async () => {
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
  });
}
