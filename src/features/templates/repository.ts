import type { SqlConnection } from '../../lib/database/connection';
import { localDate, validDate } from '../../lib/dates';

export type TemplateKind = 'task' | 'project' | 'routine' | 'workout' | 'meal';
export interface TemplateRow {
  id: string;
  kind: TemplateKind;
  name: string;
  description: string;
  payload_version: number;
  payload_json: string;
  created_at: string;
  updated_at: string;
}
type Named = {
  id: string;
  name: string;
  description?: string;
  notes?: string;
  archived_at?: string | null;
};
function required(value: string, label: string) {
  const result = value.trim();
  if (!result || result.length > 500) throw Error(`${label} deve ter entre 1 e 500 caracteres.`);
  return result;
}
export class TemplatesRepository {
  constructor(private db: SqlConnection) {}
  list(kind?: TemplateKind) {
    return this.db.select<TemplateRow[]>(
      'SELECT * FROM templates WHERE $1 IS NULL OR kind=$1 ORDER BY kind,name,id LIMIT 200',
      [kind ?? null],
    );
  }
  async snapshot(kind: TemplateKind, sourceId: string): Promise<Record<string, unknown>> {
    if (kind === 'task') {
      const [task] = await this.db.select<
        { title: string; description: string; priority: string; archived_at: string | null }[]
      >('SELECT title,description,priority,archived_at FROM tasks WHERE id=$1', [sourceId]);
      if (!task || task.archived_at) throw Error('Tarefa indisponível.');
      const subtasks = await this.db.select<{ title: string }[]>(
        'SELECT title FROM subtasks WHERE task_id=$1 ORDER BY sort_order,created_at,id',
        [sourceId],
      );
      return {
        title: task.title,
        description: task.description,
        priority: task.priority,
        subtasks,
      };
    }
    if (kind === 'project') {
      const [project] = await this.db.select<Named[]>(
        'SELECT id,name,description,archived_at FROM projects WHERE id=$1',
        [sourceId],
      );
      if (!project || project.archived_at) throw Error('Projeto indisponível.');
      const [sections, tasks] = await Promise.all([
        this.db.select<{ id: string; name: string }[]>(
          'SELECT id,name FROM project_sections WHERE project_id=$1 ORDER BY sort_order,created_at,id',
          [sourceId],
        ),
        this.db.select<{ title: string; description: string; project_section_id: string | null }[]>(
          'SELECT title,description,project_section_id FROM tasks WHERE project_id=$1 AND archived_at IS NULL ORDER BY sort_order,created_at,id',
          [sourceId],
        ),
      ]);
      return {
        name: project.name,
        description: project.description,
        sections: sections.map((s) => ({ name: s.name })),
        tasks: tasks.map((t) => ({
          title: t.title,
          description: t.description,
          sectionIndex:
            t.project_section_id === null
              ? null
              : sections.findIndex((s) => s.id === t.project_section_id),
        })),
      };
    }
    if (kind === 'routine') {
      const [routine] = await this.db.select<
        {
          name: string;
          description: string;
          frequency: string;
          weekdays: string;
          time_of_day: string | null;
          archived_at: string | null;
        }[]
      >(
        'SELECT name,description,frequency,weekdays,time_of_day,archived_at FROM routines WHERE id=$1',
        [sourceId],
      );
      if (!routine || routine.archived_at) throw Error('Rotina indisponível.');
      const items = await this.db.select<{ title: string }[]>(
        'SELECT title FROM routine_items WHERE routine_id=$1 ORDER BY sort_order,created_at,id',
        [sourceId],
      );
      return {
        name: routine.name,
        description: routine.description,
        frequency: routine.frequency,
        weekdays: JSON.parse(routine.weekdays),
        time_of_day: routine.time_of_day,
        items,
      };
    }
    if (kind === 'workout') {
      const [plan] = await this.db.select<Named[]>(
        'SELECT id,name,description FROM workout_plans WHERE id=$1',
        [sourceId],
      );
      if (!plan) throw Error('Plano indisponível.');
      const [days, weekdays, exercises] = await Promise.all([
        this.db.select<{ id: string; name: string; notes: string }[]>(
          'SELECT id,name,notes FROM workout_days WHERE workout_plan_id=$1 ORDER BY sort_order,created_at,id',
          [sourceId],
        ),
        this.db.select<{ workout_day_id: string; weekday: number }[]>(
          'SELECT w.workout_day_id,w.weekday FROM workout_day_weekdays w JOIN workout_days d ON d.id=w.workout_day_id WHERE d.workout_plan_id=$1',
          [sourceId],
        ),
        this.db.select<
          {
            workout_day_id: string;
            exercise_id: string;
            target_sets: number;
            min_reps: number;
            max_reps: number;
            rest_seconds: number | null;
            notes: string;
          }[]
        >(
          `SELECT x.workout_day_id,x.exercise_id,x.target_sets,x.min_reps,x.max_reps,x.rest_seconds,x.notes FROM workout_day_exercises x JOIN workout_days d ON d.id=x.workout_day_id JOIN exercises e ON e.id=x.exercise_id WHERE d.workout_plan_id=$1 AND e.archived_at IS NULL ORDER BY x.sort_order,x.created_at,x.id`,
          [sourceId],
        ),
      ]);
      return {
        name: plan.name,
        description: plan.description,
        days: days.map((d) => ({
          name: d.name,
          notes: d.notes,
          weekdays: weekdays.filter((w) => w.workout_day_id === d.id).map((w) => w.weekday),
          exercises: exercises
            .filter((e) => e.workout_day_id === d.id)
            .map((e) => ({
              exercise_id: e.exercise_id,
              target_sets: e.target_sets,
              min_reps: e.min_reps,
              max_reps: e.max_reps,
              rest_seconds: e.rest_seconds,
              notes: e.notes,
            })),
        })),
      };
    }
    const [meal] = await this.db.select<Named[]>(
      'SELECT id,name,notes,archived_at FROM meals WHERE id=$1',
      [sourceId],
    );
    if (!meal || meal.archived_at) throw Error('Refeição indisponível.');
    const items = await this.db.select<
      { food_id: string; quantity: number; unit: string; grams_equivalent: number; notes: string }[]
    >(
      'SELECT food_id,quantity,unit,grams_equivalent,notes FROM meal_items WHERE meal_id=$1 ORDER BY sort_order,created_at,id',
      [sourceId],
    );
    return { name: meal.name, notes: meal.notes, items };
  }
  async saveFrom(
    kind: TemplateKind,
    sourceId: string,
    name: string,
    description = '',
    templateId?: string,
  ) {
    const payload = await this.snapshot(kind, sourceId);
    const value = JSON.stringify(payload);
    if (value.length > 250000) throw Error('Template excede o tamanho permitido.');
    const id = templateId ?? crypto.randomUUID(),
      now = new Date().toISOString();
    const result = await this.db.execute(
      templateId
        ? 'UPDATE templates SET name=$1,description=$2,payload_json=$3,updated_at=$4 WHERE id=$5 AND kind=$6'
        : 'INSERT INTO templates(name,description,payload_json,updated_at,id,kind,created_at) VALUES($1,$2,$3,$4,$5,$6,$4)',
      [required(name, 'Nome do template'), description.trim(), value, now, id, kind],
    );
    if (!result.rowsAffected) throw Error('Template não encontrado.');
    return id;
  }
  async rename(id: string, name: string, description: string) {
    const result = await this.db.execute(
      'UPDATE templates SET name=$2,description=$3,updated_at=$4 WHERE id=$1',
      [id, required(name, 'Nome do template'), description.trim(), new Date().toISOString()],
    );
    if (!result.rowsAffected) throw Error('Template não encontrado.');
  }
  async apply(id: string): Promise<string> {
    const key = crypto.randomUUID();
    await this.db.execute(
      'INSERT INTO template_applications(id,template_id,applied_at) VALUES($1,$2,$3)',
      [key, id, new Date().toISOString()],
    );
    return key;
  }
  async applyMealToDiary(id: string, day = localDate()) {
    if (!validDate(day)) throw Error('Data inválida.');
    await this.db.execute(
      'INSERT INTO template_diary_applications(id,template_id,entry_date,applied_at) VALUES($1,$2,$3,$4)',
      [crypto.randomUUID(), id, day, new Date().toISOString()],
    );
  }
  async remove(id: string) {
    // Application records cascade; created entities have no foreign key to templates.
    await this.db.execute('DELETE FROM templates WHERE id=$1', [id]);
  }
}
