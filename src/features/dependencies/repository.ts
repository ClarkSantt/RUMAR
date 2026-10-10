import type { SqlConnection } from '../../lib/database/connection';

export interface DependencyRow {
  id: string;
  name: string;
  status: string;
  completed: number;
}

export interface ProjectBlocker {
  id: string;
  project_id: string;
  content: string;
  created_at: string;
  resolved_at: string | null;
}

const timestamp = () => new Date().toISOString();

export class DependenciesRepository {
  constructor(private readonly db: SqlConnection) {}

  taskDependencies(taskId: string) {
    return this.db.select<DependencyRow[]>(
      `SELECT t.id,t.title name,t.status,(t.status='completed') completed
       FROM task_dependencies d JOIN tasks t ON t.id=d.predecessor_id
       WHERE d.task_id=$1 AND t.deleted_at IS NULL ORDER BY completed,t.title`,
      [taskId],
    );
  }

  taskDependents(taskId: string) {
    return this.db.select<DependencyRow[]>(
      `SELECT t.id,t.title name,t.status,(t.status='completed') completed
       FROM task_dependencies d JOIN tasks t ON t.id=d.task_id
       WHERE d.predecessor_id=$1 AND t.deleted_at IS NULL ORDER BY completed,t.title`,
      [taskId],
    );
  }

  taskCandidates(taskId: string, query = '') {
    return this.db.select<DependencyRow[]>(
      `SELECT id,title name,status,(status='completed') completed FROM tasks
       WHERE id<>$1 AND archived_at IS NULL AND deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM task_dependencies WHERE task_id=$1 AND predecessor_id=tasks.id)
        AND ($2='' OR instr(lower(title),lower($2))>0)
       ORDER BY status,title LIMIT 30`,
      [taskId, query.trim()],
    );
  }

  async addTaskDependency(taskId: string, predecessorId: string) {
    if (taskId === predecessorId) throw new Error('Uma tarefa não pode depender dela mesma.');
    const cycle = await this.db.select<{ found: number }[]>(
      `WITH RECURSIVE downstream(id) AS (
         SELECT task_id FROM task_dependencies WHERE predecessor_id=$1
         UNION SELECT d.task_id FROM task_dependencies d JOIN downstream x ON d.predecessor_id=x.id
       ) SELECT EXISTS(SELECT 1 FROM downstream WHERE id=$2) found`,
      [taskId, predecessorId],
    );
    if (cycle[0]?.found) throw new Error('Essa relação criaria um ciclo entre tarefas.');
    await this.db.execute(
      'INSERT OR IGNORE INTO task_dependencies(task_id,predecessor_id,created_at) VALUES($1,$2,$3)',
      [taskId, predecessorId, timestamp()],
    );
  }

  removeTaskDependency(taskId: string, predecessorId: string) {
    return this.db.execute('DELETE FROM task_dependencies WHERE task_id=$1 AND predecessor_id=$2', [
      taskId,
      predecessorId,
    ]);
  }

  projectDependencies(projectId: string) {
    return this.db.select<DependencyRow[]>(
      `SELECT p.id,p.name,p.status,(p.status='completed') completed
       FROM project_dependencies d JOIN projects p ON p.id=d.predecessor_id
       WHERE d.project_id=$1 AND p.deleted_at IS NULL ORDER BY completed,p.name`,
      [projectId],
    );
  }

  projectCandidates(projectId: string, query = '') {
    return this.db.select<DependencyRow[]>(
      `SELECT id,name,status,(status='completed') completed FROM projects
       WHERE id<>$1 AND archived_at IS NULL AND deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM project_dependencies WHERE project_id=$1 AND predecessor_id=projects.id)
        AND ($2='' OR instr(lower(name),lower($2))>0)
       ORDER BY status,name LIMIT 30`,
      [projectId, query.trim()],
    );
  }

  async addProjectDependency(projectId: string, predecessorId: string) {
    if (projectId === predecessorId) throw new Error('Um projeto não pode depender dele mesmo.');
    const cycle = await this.db.select<{ found: number }[]>(
      `WITH RECURSIVE downstream(id) AS (
         SELECT project_id FROM project_dependencies WHERE predecessor_id=$1
         UNION SELECT d.project_id FROM project_dependencies d JOIN downstream x ON d.predecessor_id=x.id
       ) SELECT EXISTS(SELECT 1 FROM downstream WHERE id=$2) found`,
      [projectId, predecessorId],
    );
    if (cycle[0]?.found) throw new Error('Essa relação criaria um ciclo entre projetos.');
    await this.db.execute(
      'INSERT OR IGNORE INTO project_dependencies(project_id,predecessor_id,created_at) VALUES($1,$2,$3)',
      [projectId, predecessorId, timestamp()],
    );
  }

  removeProjectDependency(projectId: string, predecessorId: string) {
    return this.db.execute(
      'DELETE FROM project_dependencies WHERE project_id=$1 AND predecessor_id=$2',
      [projectId, predecessorId],
    );
  }

  blockers(projectId: string) {
    return this.db.select<ProjectBlocker[]>(
      'SELECT * FROM project_blockers WHERE project_id=$1 ORDER BY resolved_at IS NOT NULL,created_at DESC',
      [projectId],
    );
  }

  async addBlocker(projectId: string, content: string) {
    const value = content.trim();
    if (!value || value.length > 1000)
      throw new Error('Descreva o bloqueio em até 1000 caracteres.');
    await this.db.execute(
      'INSERT INTO project_blockers(id,project_id,content,created_at) VALUES($1,$2,$3,$4)',
      [crypto.randomUUID(), projectId, value, timestamp()],
    );
  }

  resolveBlocker(id: string, resolved = true) {
    return this.db.execute('UPDATE project_blockers SET resolved_at=$2 WHERE id=$1', [
      id,
      resolved ? timestamp() : null,
    ]);
  }

  removeBlocker(id: string) {
    return this.db.execute('DELETE FROM project_blockers WHERE id=$1', [id]);
  }
}
