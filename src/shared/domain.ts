export type EntityId = string;

export interface Task {
  id: EntityId;
  title: string;
  projectIds: EntityId[];
  tags: string[];
  defaultNote: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: EntityId;
  title: string;
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
  projectIds?: EntityId[];
  tags?: string[];
  defaultNote?: string;
}

export interface UpdateTaskInput {
  title?: string;
  projectIds?: EntityId[];
  tags?: string[];
  defaultNote?: string;
  archived?: boolean;
}

export interface CreateProjectInput {
  title: string;
}

export interface UpdateProjectInput {
  title?: string;
  archived?: boolean;
}

export interface UpdateTimeEntryInput {
  taskId: EntityId;
  startedAt: string;
  endedAt: string;
  note?: string;
}
