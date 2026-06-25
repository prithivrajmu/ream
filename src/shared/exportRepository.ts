import type { TimesheetDatabase } from "./db";
import type { TimesheetExport } from "./reporting";

export async function readAllExportData(database: TimesheetDatabase): Promise<TimesheetExport> {
  const [tasks, timeEntries] = await Promise.all([
    database.tasks.toArray(),
    database.timeEntries.toArray()
  ]);

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    tasks,
    timeEntries
  };
}

export async function importTimesheetData(database: TimesheetDatabase, exportData: TimesheetExport): Promise<void> {
  await database.transaction("rw", database.tasks, database.timeEntries, database.activeTimers, async () => {
    await database.activeTimers.clear();
    await database.tasks.clear();
    await database.timeEntries.clear();
    await database.tasks.bulkPut(exportData.tasks);
    await database.timeEntries.bulkPut(exportData.timeEntries);
  });
}
