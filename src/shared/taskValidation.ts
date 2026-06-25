import type { CreateTaskInput, UpdateTaskInput } from "./domain";

export function normalizeTaskTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

export function normalizeTags(tags: string[] = []): string[] {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  ).sort();
}

export function parseTags(value: string): string[] {
  return normalizeTags(value.split(","));
}

export function validateCreateTask(input: CreateTaskInput): string | null {
  if (!normalizeTaskTitle(input.title)) {
    return "Task title is required.";
  }

  return null;
}

export function validateUpdateTask(input: UpdateTaskInput): string | null {
  if (input.title !== undefined && !normalizeTaskTitle(input.title)) {
    return "Task title is required.";
  }

  return null;
}
