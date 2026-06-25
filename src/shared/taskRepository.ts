import type { CreateTaskInput, Task, UpdateTaskInput } from "./domain";
import { createId } from "./id";
import { normalizeTags, normalizeTaskTitle, validateCreateTask, validateUpdateTask } from "./taskValidation";
import type { TimesheetDatabase } from "./db";

export async function createTask(database: TimesheetDatabase, input: CreateTaskInput): Promise<Task> {
  const validationError = validateCreateTask(input);
  if (validationError) {
    throw new Error(validationError);
  }

  const now = new Date().toISOString();
  const task: Task = {
    id: createId("task"),
    title: normalizeTaskTitle(input.title),
    project: input.project?.trim() ?? "",
    tags: normalizeTags(input.tags),
    defaultNote: input.defaultNote?.trim() ?? "",
    archived: false,
    createdAt: now,
    updatedAt: now
  };

  await database.tasks.add(task);
  return task;
}

export async function listActiveTasks(database: TimesheetDatabase): Promise<Task[]> {
  const tasks = await database.tasks.toArray();
  return sortTasks(tasks.filter((task) => !task.archived));
}

export async function listAllTasks(database: TimesheetDatabase): Promise<Task[]> {
  const tasks = await database.tasks.toArray();
  return sortTasks(tasks);
}

export async function updateTask(
  database: TimesheetDatabase,
  taskId: string,
  input: UpdateTaskInput
): Promise<Task> {
  const validationError = validateUpdateTask(input);
  if (validationError) {
    throw new Error(validationError);
  }

  const existing = await database.tasks.get(taskId);
  if (!existing) {
    throw new Error("Task not found.");
  }

  const updated: Task = {
    ...existing,
    title: input.title === undefined ? existing.title : normalizeTaskTitle(input.title),
    project: input.project === undefined ? existing.project : input.project.trim(),
    tags: input.tags === undefined ? existing.tags : normalizeTags(input.tags),
    defaultNote: input.defaultNote === undefined ? existing.defaultNote : input.defaultNote.trim(),
    archived: input.archived === undefined ? existing.archived : input.archived,
    updatedAt: new Date().toISOString()
  };

  await database.tasks.put(updated);
  return updated;
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    if (left.archived !== right.archived) {
      return left.archived ? 1 : -1;
    }

    return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
  });
}
