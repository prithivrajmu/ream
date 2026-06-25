export type EntityId = string;

export interface Task {
  id: EntityId;
  title: string;
  project: string;
  tags: string[];
  defaultNote: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TimeEntry {
  id: EntityId;
  taskId: EntityId;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveTimer {
  id: EntityId;
  taskId: EntityId;
  startedAt: string;
  note: string;
  pausedAt: string;
  totalPausedSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  project?: string;
  tags?: string[];
  defaultNote?: string;
}

export interface UpdateTaskInput {
  title?: string;
  project?: string;
  tags?: string[];
  defaultNote?: string;
  archived?: boolean;
}
