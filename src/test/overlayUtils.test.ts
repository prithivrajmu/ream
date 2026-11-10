import { describe, expect, it } from "vitest";
import type { Project, Task } from "../shared/domain";
import { buildOverlayProjectTagLabels } from "../renderer/overlayUtils";

function project(id: string, title: string): Project {
  return {
    id,
    title,
    archived: false,
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z"
  };
}

function task(input: Partial<Task> = {}): Task {
  return {
    id: "task_1",
    title: "Write plan",
    projectIds: [],
    tags: [],
    defaultNote: "",
    archived: false,
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    ...input
  };
}

describe("overlay utilities", () => {
  it("shows active projects even when the selected task is not linked to them", () => {
    expect(buildOverlayProjectTagLabels(
      [project("project_product", "Product"), project("project_client", "Client")],
      task({ tags: ["meeting"] })
    )).toEqual(["Product", "Client", "meeting"]);
  });

  it("deduplicates project and task tag labels", () => {
    expect(buildOverlayProjectTagLabels(
      [project("project_product", " Product "), project("project_research", "Research")],
      task({ tags: ["product", "planning", ""] })
    )).toEqual(["Product", "Research", "planning"]);
  });
});
