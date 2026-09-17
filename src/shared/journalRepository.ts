import type { JournalPage, JournalRecap } from "./domain";
import type { ReamDatabase } from "./db";
import { createId } from "./id";
import { assertWorkspaceRevision } from "./workspaceRepository";
import { assertNoteUnchanged } from "./noteConflict";

export interface SaveJournalRecapInput {
  journalDateKey: string;
  sourceStartDateKey: string;
  sourceEndDateKey: string;
  markdown: string;
  model: string;
}

export async function getJournalPage(database: ReamDatabase, dateKey: string): Promise<JournalPage | null> {
  return (await database.journalPages.where("dateKey").equals(dateKey).first()) ?? null;
}

export async function saveJournalPage(database: ReamDatabase, dateKey: string, markdown: string, now = new Date(), expectedRevision?: number, expectedMarkdown?: string): Promise<JournalPage | null> {
  return database.transaction("rw", [database.journalPages, database.workspaceState], async () => {
    await assertWorkspaceRevision(database, expectedRevision);
    const existing = await getJournalPage(database, dateKey);
    assertNoteUnchanged(existing?.markdown ?? "", expectedMarkdown, markdown);
    const normalizedMarkdown = markdown.trim();
    if (!existing && !normalizedMarkdown) {
      return null;
    }

    const timestamp = now.toISOString();
    const page: JournalPage = existing
      ? { ...existing, markdown, updatedAt: timestamp }
      : { id: createId("journal"), dateKey, markdown, createdAt: timestamp, updatedAt: timestamp };
    await database.journalPages.put(page);
    return page;
  });
}

async function ensureJournalPage(database: ReamDatabase, dateKey: string, now = new Date()): Promise<JournalPage> {
  const existing = await getJournalPage(database, dateKey);
  if (existing) {
    return existing;
  }
  const timestamp = now.toISOString();
  const page: JournalPage = { id: createId("journal"), dateKey, markdown: "", createdAt: timestamp, updatedAt: timestamp };
  await database.journalPages.add(page);
  return page;
}

export async function listJournalPages(database: ReamDatabase): Promise<JournalPage[]> {
  return (await database.journalPages.toArray()).sort((left, right) => right.dateKey.localeCompare(left.dateKey));
}

export async function listJournalPagesInRange(database: ReamDatabase, startDateKey: string, endDateKey: string): Promise<JournalPage[]> {
  return database.journalPages.where("dateKey").between(startDateKey, endDateKey, true, true).sortBy("dateKey");
}

export async function listJournalRecapsForDate(database: ReamDatabase, journalDateKey: string): Promise<JournalRecap[]> {
  const recaps = await database.journalRecaps.where("journalDateKey").equals(journalDateKey).toArray();
  return recaps.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function listJournalRecaps(database: ReamDatabase): Promise<JournalRecap[]> {
  return (await database.journalRecaps.toArray()).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function findMatchingJournalRecaps(database: ReamDatabase, sourceStartDateKey: string, sourceEndDateKey: string): Promise<JournalRecap[]> {
  const recaps = await database.journalRecaps
    .where("[sourceStartDateKey+sourceEndDateKey]")
    .equals([sourceStartDateKey, sourceEndDateKey])
    .toArray();
  return recaps.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createJournalRecap(database: ReamDatabase, input: SaveJournalRecapInput, now = new Date(), expectedRevision?: number): Promise<JournalRecap> {
  return database.transaction("rw", [database.journalPages, database.journalRecaps, database.workspaceState], async () => {
    await assertWorkspaceRevision(database, expectedRevision);
    const page = await ensureJournalPage(database, input.journalDateKey, now);
    const timestamp = now.toISOString();
    const recap: JournalRecap = {
      id: createId("recap"),
      journalPageId: page.id,
      journalDateKey: input.journalDateKey,
      sourceStartDateKey: input.sourceStartDateKey,
      sourceEndDateKey: input.sourceEndDateKey,
      markdown: input.markdown,
      model: input.model,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await database.journalRecaps.add(recap);
    return recap;
  });
}

export async function replaceJournalRecap(database: ReamDatabase, recapId: string, markdown: string, model: string, now = new Date(), expectedRevision?: number): Promise<JournalRecap> {
  return database.transaction("rw", [database.journalRecaps, database.workspaceState], async () => {
    await assertWorkspaceRevision(database, expectedRevision);
    const existing = await database.journalRecaps.get(recapId);
    if (!existing) {
      throw new Error("Journal recap not found.");
    }
    const updated = { ...existing, markdown, model, updatedAt: now.toISOString() };
    await database.journalRecaps.put(updated);
    return updated;
  });
}

export async function searchJournal(database: ReamDatabase, query: string): Promise<Array<JournalPage | JournalRecap>> {
  const normalized = query.trim().toLocaleLowerCase();
  const [pages, recaps] = await Promise.all([listJournalPages(database), listJournalRecaps(database)]);
  if (!normalized) {
    return [...pages, ...recaps];
  }
  return [...pages, ...recaps].filter((record) => record.markdown.toLocaleLowerCase().includes(normalized));
}
