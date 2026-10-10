export type Priority = 'low' | 'normal' | 'high';
export type Theme = 'light' | 'dark' | 'system';
export type Recurrence = {
  frequency: 'daily' | 'weekly' | 'weekdays' | 'monthly';
  weekdays?: number[];
  until?: string;
};
export interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  due_date: string | null;
  due_time: string | null;
  remind_minutes_before?: number | null;
  status: 'pending' | 'completed';
  recurrence: Recurrence | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
  deleted_at?: string | null;
  sort_order: number;
  source_inbox_id: string | null;
  project_id?: string | null;
  project_section_id?: string | null;
  blocked?: number;
}
export type TaskInput = Pick<
  Task,
  'title' | 'description' | 'priority' | 'due_date' | 'due_time' | 'recurrence'
> & {
  project_id?: string | null;
  project_section_id?: string | null;
  remind_minutes_before?: number | null;
};
export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  completed: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export interface Completion {
  task_id: string;
  occurrence_date: string;
  completed_at: string;
}
export interface SubtaskCompletion {
  subtask_id: string;
  occurrence_date: string;
  completed_at: string;
}
export interface InboxItem {
  id: string;
  content: string;
  notes: string;
  capture_type: 'unclassified' | 'task' | 'planning' | 'thought' | 'project' | 'event' | 'habit';
  status: 'pending' | 'processed' | 'archived';
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}
export interface Snapshot {
  tasks: Task[];
  subtasks: Subtask[];
  completions: Completion[];
  subtaskCompletions: SubtaskCompletion[];
  inbox: InboxItem[];
  settings: { name: string; theme: Theme };
}
export interface TaskOccurrence {
  task: Task;
  date: string | null;
  completed: boolean;
  completedAt?: string;
  historical?: boolean;
}
