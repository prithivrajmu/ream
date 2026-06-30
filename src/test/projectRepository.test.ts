import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ReamDatabase } from "../shared/db";
import { archiveProject, createProject, listActiveProjects } from "../shared/projectRepository";
import { createTask } from "../shared/taskRepository";

let database: ReamDatabase | null = null;

function createTestDatabase(): ReamDatabase {
  database = new ReamDatabase(`ream-project-test-${crypto.randomUUID()}`);
  return database;
}

afterEach(async () => {
  await database?.delete();
  database = null;
});

describe("project repository", () => {
  it("rejects duplicate active project names without case sensitivity", async () => {
    const db = createTestDatabase();
    await createProject(db, { title: "Client Work" });

    await expect(createProject(db, { title: " client work " })).rejects.toThrow(
      "A project with that name already exists."
    );
  });

  it("creates managed projects and removes an archived project from assigned tasks", async () => {
    const db = createTestDatabase();
    const client = await createProject(db, { title: "  Client work " });
    const internal = await createProject(db, { title: "Internal" });
    const task = await createTask(db, { title: "Prepare demo", projectIds: [client.id, internal.id] });

    await archiveProject(db, client.id);

    await expect(listActiveProjects(db)).resolves.toMatchObject([{ id: internal.id, title: "Internal" }]);
    await expect(db.tasks.get(task.id)).resolves.toMatchObject({ projectIds: [internal.id] });
  });
});
