import type { TimesheetDatabase } from "./db";
import type { TimesheetExport } from "./reporting";

export async function readAllExportData(database: TimesheetDatabase): Promise<TimesheetExport> {
  const [tasks, projects, timeEntries] = await Promise.all([
    database.tasks.toArray(),
    database.projects.toArray(),
    database.timeEntries.toArray()
  ]);

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 2,
    tasks,
    projects,
    timeEntries
  };
}

export async function importTimesheetData(database: TimesheetDatabase, exportData: TimesheetExport): Promise<void> {
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
