import type { ReamDatabase } from "./db";
import type { ReamExport } from "./reporting";

export async function readAllExportData(database: ReamDatabase): Promise<ReamExport> {
  const [tasks, projects, timeEntries] = await Promise.all([
    database.tasks.toArray(),
    database.projects.toArray(),
    database.timeEntries.toArray()
  ]);

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 3,
    tasks,
    projects,
    timeEntries
  };
}

export async function importReamData(database: ReamDatabase, exportData: ReamExport): Promise<void> {
  await database.transaction("rw", database.tasks, database.projects, database.timeEntries, database.activeTimers, database.noteAiSuggestions, async () => {
    await database.activeTimers.clear();
    await database.noteAiSuggestions.clear();
    await database.tasks.clear();
    await database.projects.clear();
    await database.timeEntries.clear();
    await database.tasks.bulkPut(exportData.tasks);
    await database.projects.bulkPut(exportData.projects);
    await database.timeEntries.bulkPut(exportData.timeEntries);
  });
}
