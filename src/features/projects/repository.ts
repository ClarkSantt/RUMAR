import type { SqlConnection } from '../../lib/database/connection';
import { validDate } from '../../lib/dates';
import type { ProjectInput, ProjectSection, ProjectStatus, ProjectSummary } from './types';

const now = () => new Date().toISOString();
function name(value: string) {
  const result = value.trim();
  if (!result || Array.from(result).length > 500)
    throw new Error('Informe um nome com até 500 caracteres.');
  return result;
}
function validate(input: ProjectInput) {
  if (
    (input.start_date && !validDate(input.start_date)) ||
    (input.target_date && !validDate(input.target_date))
  )
    throw new Error('Informe datas válidas.');
  if (input.start_date && input.target_date && input.target_date < input.start_date)
    throw new Error('O prazo deve ser igual ou posterior ao início.');
  return { ...input, name: name(input.name) };
}
export class ProjectsRepository {
  constructor(private readonly db: SqlConnection) {}
  list(status?: ProjectStatus) {
    return this.db.select<ProjectSummary[]>(
      `SELECT p.*,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.archived_at IS NULL) task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.archived_at IS NULL AND t.status='completed') completed_count,
      (SELECT t.title FROM tasks t LEFT JOIN project_sections s ON s.id=t.project_section_id WHERE t.project_id=p.id AND t.archived_at IS NULL AND t.status='pending' ORDER BY COALESCE(s.sort_order,-1),t.sort_order,t.created_at,t.id LIMIT 1) next_task
      FROM projects p WHERE ($1 IS NULL AND p.archived_at IS NULL) OR p.status=$1 ORDER BY p.sort_order,p.created_at,p.id`,
      [status ?? null],
    );
  }
  async create(input: ProjectInput) {
    const v = validate(input),
      id = crypto.randomUUID();
    await this.db.execute(
      'INSERT INTO projects(id,name,description,start_date,target_date,sort_order,created_at,updated_at) VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(sort_order),0)+1 FROM projects),$6,$6)',
      [id, v.name, v.description, v.start_date, v.target_date, now()],
    );
    return id;
  }
  async update(id: string, input: ProjectInput) {
    const v = validate(input);
    await this.db.execute(
      'UPDATE projects SET name=$2,description=$3,start_date=$4,target_date=$5,updated_at=$6 WHERE id=$1',
      [id, v.name, v.description, v.start_date, v.target_date, now()],
    );
  }
  async setStatus(id: string, status: ProjectStatus, confirmPending = false) {
    if (!['active', 'paused', 'completed', 'archived'].includes(status))
      throw new Error('Status inválido.');
    // The pending-task guard belongs to the same SQL statement as the mutation.
    const result = await this.db.execute(
      `UPDATE projects SET status=$2,completed_at=CASE WHEN $2='completed' THEN $3 ELSE NULL END,archived_at=CASE WHEN $2='archived' THEN $3 ELSE NULL END,updated_at=$3 WHERE id=$1 AND ($2!='completed' OR $4=1 OR NOT EXISTS(SELECT 1 FROM tasks WHERE project_id=$1 AND archived_at IS NULL AND status='pending'))`,
      [id, status, now(), Number(confirmPending)],
    );
    if (!result.rowsAffected)
      throw new Error('Confirme a conclusão do projeto com tarefas pendentes.');
  }
  async remove(id: string, deleteTasks = false) {
    // Migration triggers keep deletion and optional task deletion in one atomic statement.
    await this.db.execute(
      deleteTasks
        ? 'UPDATE projects SET delete_tasks=1 WHERE id=$1'
        : 'DELETE FROM projects WHERE id=$1',
      [id],
    );
  }
  sections(projectId: string) {
    return this.db.select<ProjectSection[]>(
      'SELECT * FROM project_sections WHERE project_id=$1 ORDER BY sort_order,created_at,id',
      [projectId],
    );
  }
  async createSection(projectId: string, title: string) {
    const id = crypto.randomUUID();
    await this.db.execute(
      'INSERT INTO project_sections(id,project_id,name,sort_order,created_at,updated_at) VALUES($1,$2,$3,(SELECT COALESCE(MAX(sort_order),0)+1 FROM project_sections WHERE project_id=$2),$4,$4)',
      [id, projectId, name(title), now()],
    );
    return id;
  }
  async renameSection(id: string, title: string) {
    await this.db.execute('UPDATE project_sections SET name=$2,updated_at=$3 WHERE id=$1', [
      id,
      name(title),
      now(),
    ]);
  }
  async deleteSection(id: string) {
    await this.db.execute('DELETE FROM project_sections WHERE id=$1', [id]);
  }
  async moveSection(projectId: string, id: string, direction: -1 | 1) {
    const sections = await this.sections(projectId),
      index = sections.findIndex((s) => s.id === id),
      other = sections[index + direction];
    if (index < 0 || !other) return;
    await this.db.execute(
      'UPDATE project_sections SET sort_order=CASE WHEN id=$2 THEN $5 ELSE $4 END,updated_at=$6 WHERE project_id=$1 AND id IN($2,$3)',
      [projectId, id, other.id, sections[index].sort_order, other.sort_order, now()],
    );
  }
  linkedHabits(projectId: string) {
    return this.db.select<{ id: string; name: string }[]>(
      'SELECT id,name FROM habits WHERE project_id=$1 AND archived_at IS NULL ORDER BY sort_order,created_at',
      [projectId],
    );
  }
}
