import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ReamDatabase } from "../shared/db";
import { createJournalRecap, findMatchingJournalRecaps, getJournalPage, listJournalPagesInRange, replaceJournalRecap, saveJournalPage, searchJournal } from "../shared/journalRepository";

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
