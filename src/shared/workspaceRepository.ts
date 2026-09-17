import type { ReamDatabase } from "./db";

export async function readWorkspaceRevision(database: ReamDatabase): Promise<number> {
  return (await database.workspaceState.get("restore"))?.revision ?? 0;
}

export async function assertWorkspaceRevision(database: ReamDatabase, expectedRevision?: number): Promise<void> {
  if (expectedRevision !== undefined && await readWorkspaceRevision(database) !== expectedRevision) {
    throw new Error("The workspace was restored. This older edit cannot overwrite the imported notes.");
  }
}

export function journalDraftContext(dateKey: string, revision: number): string {
  // Keep pre-upgrade recovery drafts available until the first restore.
  return revision === 0 ? `journal:${dateKey}` : `workspace:${revision}:journal:${dateKey}`;
}
