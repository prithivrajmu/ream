import type { Project, Task } from "../shared/domain";

export function buildOverlayProjectTagLabels(projects: Project[], task?: Task | null): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  function addLabel(label: string) {
    const normalized = label.trim();
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) {
      return;
    }

    seen.add(key);
    labels.push(normalized);
  }

  projects.forEach((project) => addLabel(project.title));
  task?.tags.forEach(addLabel);
  return labels;
}
