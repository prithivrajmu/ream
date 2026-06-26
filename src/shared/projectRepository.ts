import type { CreateProjectInput, Project, UpdateProjectInput } from "./domain";
import type { TimesheetDatabase } from "./db";
import { createId } from "./id";

export async function createProject(database: TimesheetDatabase, input: CreateProjectInput): Promise<Project> {
  const title = normalizeProjectTitle(input.title);
  if (!title) {
    throw new Error("Project name is required.");
  }

  const existing = await database.projects.filter((project) => !project.archived && project.title.localeCompare(title, undefined, { sensitivity: "accent" }) === 0).first();
  if (existing) {
    throw new Error("A project with that name already exists.");
  }

  const now = new Date().toISOString();
  const project: Project = { id: createId("project"), title, archived: false, createdAt: now, updatedAt: now };
  await database.projects.add(project);
  return project;
}

export async function listActiveProjects(database: TimesheetDatabase): Promise<Project[]> {
  return sortProjects((await database.projects.toArray()).filter((project) => !project.archived));
}

export async function listAllProjects(database: TimesheetDatabase): Promise<Project[]> {
  return sortProjects(await database.projects.toArray());
}

export async function updateProject(database: TimesheetDatabase, projectId: string, input: UpdateProjectInput): Promise<Project> {
  const existing = await database.projects.get(projectId);
  if (!existing) {
    throw new Error("Project not found.");
  }

  const title = input.title === undefined ? existing.title : normalizeProjectTitle(input.title);
  if (!title) {
    throw new Error("Project name is required.");
  }

  const updated: Project = { ...existing, title, archived: input.archived ?? existing.archived, updatedAt: new Date().toISOString() };
  await database.projects.put(updated);
  return updated;
}

export async function archiveProject(database: TimesheetDatabase, projectId: string): Promise<void> {
  await database.transaction("rw", database.projects, database.tasks, async () => {
    const project = await database.projects.get(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    await database.projects.put({ ...project, archived: true, updatedAt: new Date().toISOString() });
    const tasks = await database.tasks.toArray();
    await database.tasks.bulkPut(tasks.map((task) => task.projectIds.includes(projectId) ? { ...task, projectIds: task.projectIds.filter((id) => id !== projectId), updatedAt: new Date().toISOString() } : task));
  });
}

export function normalizeProjectTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: "base" }));
}
