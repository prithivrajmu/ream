import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ReamDatabase } from "../shared/db";
import { createJournalRecap, findMatchingJournalRecaps, getJournalPage, listJournalPagesInRange, replaceJournalRecap, saveJournalPage, searchJournal } from "../shared/journalRepository";
import { importReamData, readAllExportData } from "../shared/exportRepository";

const databases: ReamDatabase[] = [];
function createDatabase() {
  const database = new ReamDatabase(`ream-journal-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("journal repository", () => {
  const recapInput = {
    journalDateKey: "2026-09-16", sourceStartDateKey: "2026-09-15", sourceEndDateKey: "2026-09-15",
    markdown: "Synthetic recap", model: "test-model"
  };

  it("creates concurrent recaps and handwritten notes under one journal page", async () => {
    const database = createDatabase();
    await Promise.all([
      createJournalRecap(database, recapInput),
      createJournalRecap(database, recapInput),
      saveJournalPage(database, recapInput.journalDateKey, "Handwritten note")
    ]);
    expect(await database.journalPages.count()).toBe(1);
    expect(await database.journalRecaps.count()).toBe(2);
    expect((await getJournalPage(database, recapInput.journalDateKey))?.markdown).toBe("Handwritten note");
  });

  it("does not leave a placeholder journal page after a failed recap save", async () => {
    const database = createDatabase();
    database.journalRecaps.hook("creating", () => { throw new Error("Storage failure"); });
    await expect(createJournalRecap(database, recapInput)).rejects.toThrow("Storage failure");
    expect(await database.journalPages.count()).toBe(0);
    expect(await database.journalRecaps.count()).toBe(0);
  });

  it("rejects AI results that finish after a restore, even if recap IDs match", async () => {
    const database = createDatabase();
    const recap = await createJournalRecap(database, recapInput, new Date(), 0);
    await importReamData(database, await readAllExportData(database));
    await expect(createJournalRecap(database, recapInput, new Date(), 0)).rejects.toThrow("workspace was restored");
    await expect(replaceJournalRecap(database, recap.id, "Stale result", "test-model", new Date(), 0)).rejects.toThrow("workspace was restored");
    expect(await database.journalRecaps.toArray()).toEqual([recap]);
    await replaceJournalRecap(database, recap.id, "Current result", "test-model", new Date(), 1);
    expect((await database.journalRecaps.get(recap.id))?.markdown).toBe("Current result");
  });

  it("keeps one page per date and does not create empty pages", async () => {
    const database = createDatabase();
    await expect(saveJournalPage(database, "2026-07-11", "")).resolves.toBeNull();
    const created = await saveJournalPage(database, "2026-07-11", "First thought", new Date("2026-07-11T06:00:00.000Z"));
    const updated = await saveJournalPage(database, "2026-07-11", "Updated thought", new Date("2026-07-11T07:00:00.000Z"));
    expect(updated?.id).toBe(created?.id);
    await expect(database.journalPages.count()).resolves.toBe(1);
    await expect(getJournalPage(database, "2026-07-11")).resolves.toMatchObject({ markdown: "Updated thought" });
  });

  it("queries handwritten pages by inclusive local date keys", async () => {
    const database = createDatabase();
    await saveJournalPage(database, "2026-07-09", "Before");
    await saveJournalPage(database, "2026-07-10", "Yesterday");
    await saveJournalPage(database, "2026-07-11", "Today");
    await expect(listJournalPagesInRange(database, "2026-07-10", "2026-07-11")).resolves.toMatchObject([
      { dateKey: "2026-07-10" }, { dateKey: "2026-07-11" }
    ]);
  });

  it("appends, finds, replaces, and searches recaps independently of handwritten text", async () => {
    const database = createDatabase();
    const recap = await createJournalRecap(database, {
      journalDateKey: "2026-07-11",
      sourceStartDateKey: "2026-07-10",
      sourceEndDateKey: "2026-07-10",
      markdown: "## Recap\n\nShipped the release",
      model: "llama3.2:3b"
    });
    await expect(findMatchingJournalRecaps(database, "2026-07-10", "2026-07-10")).resolves.toHaveLength(1);
    await replaceJournalRecap(database, recap.id, "## Recap\n\nUpdated summary", "llama3.2:1b");
    await expect(searchJournal(database, "updated summary")).resolves.toMatchObject([{ id: recap.id, model: "llama3.2:1b" }]);
    await expect(database.journalPages.count()).resolves.toBe(1);
  });
});
