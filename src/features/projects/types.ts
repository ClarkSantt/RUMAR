export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';
export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  start_date: string | null;
  target_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
  sort_order: number;
}
export type ProjectInput = Pick<Project, 'name' | 'description' | 'start_date' | 'target_date'>;
export interface ProjectSection {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export interface ProjectSummary extends Project {
  task_count: number;
  completed_count: number;
  next_task: string | null;
}
