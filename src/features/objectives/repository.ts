import type { SqlConnection } from '../../lib/database/connection';
import { localDate } from '../../lib/dates';
import { milestoneReadSql } from './milestones-repository';

export const objectiveCategories = [
  'personal',
  'health',
  'learning',
  'finance',
  'professional',
  'other',
] as const;
export const objectiveStatuses = ['active', 'paused', 'completed', 'archived'] as const;
export const objectiveLinkTypes = [
  'task',
  'project',
  'habit',
  'routine',
  'workout_plan',
  'financial_goal',
  'thought',
  'body_metric',
  'activity',
  'nutrition',
] as const;
export const bodyMetrics = [
  'weight',
  'body_fat',
  'neck',
  'shoulders',
  'waist',
  'abdomen',
  'chest',
  'hips',
  'left_arm',
  'right_arm',
  'left_forearm',
  'right_forearm',
  'left_thigh',
  'right_thigh',
  'left_calf',
  'right_calf',
] as const;
export type ObjectiveCategory = (typeof objectiveCategories)[number];
export type ObjectiveStatus = (typeof objectiveStatuses)[number];
export type ObjectiveLinkType = (typeof objectiveLinkTypes)[number];
export type ProgressMode = 'none' | 'manual' | 'project' | 'financial_goal' | 'body_metric';

export interface Objective {
  id: string;
  name: string;
  description: string;
  category: ObjectiveCategory;
  status: ObjectiveStatus;
  start_date: string;
  target_date: string | null;
  progress_mode: ProgressMode;
  progress_ref: string | null;
  manual_current: number | null;
  manual_target: number | null;
  manual_unit: string;
  body_baseline: number | null;
  body_target: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
}
export interface ObjectiveLink {
  id: string;
  objective_id: string;
  entity_type: ObjectiveLinkType;
  entity_id: string;
  name: string;
  created_at: string;
}
export interface ObjectiveUpdate {
  id: string;
  objective_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}
export interface ObjectiveProgress {
  label: string;
  current: number;
  target: number | null;
  unit: string;
  percent: number | null;
  hidden?: boolean;
}
export type ObjectiveDraft = Pick<
  Objective,
  | 'name'
  | 'description'
  | 'category'
  | 'start_date'
  | 'target_date'
  | 'progress_mode'
  | 'progress_ref'
  | 'manual_current'
  | 'manual_target'
  | 'manual_unit'
  | 'body_baseline'
  | 'body_target'
>;

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const positive = (value: number | null) => value === null || (Number.isFinite(value) && value > 0);
const percent = (current: number, target: number | null) =>
  target && target > 0 ? Math.max(0, Math.min(100, (current / target) * 100)) : null;

export class ObjectivesRepository {
  constructor(private db: SqlConnection) {}

  list() {
    return this.db.select<(Objective & { link_count: number })[]>(
      `SELECT o.*,COUNT(l.id) link_count FROM objectives o LEFT JOIN objective_links l ON l.objective_id=o.id
       GROUP BY o.id ORDER BY CASE o.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,o.updated_at DESC`,
    );
  }
  async get(id: string) {
    return (
      (await this.db.select<Objective[]>('SELECT * FROM objectives WHERE id=$1', [id]))[0] ?? null
    );
  }
  async create(draft: ObjectiveDraft) {
    this.validate(draft);
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO objectives(id,name,description,category,start_date,target_date,progress_mode,progress_ref,manual_current,manual_target,manual_unit,body_baseline,body_target,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
      [
        id,
        draft.name.trim(),
        draft.description.trim(),
        draft.category,
        draft.start_date,
        draft.target_date,
        draft.progress_mode,
        draft.progress_ref,
        draft.manual_current,
        draft.manual_target,
        draft.manual_unit.trim(),
        draft.body_baseline,
        draft.body_target,
        now,
      ],
    );
    return id;
  }
  async update(id: string, draft: ObjectiveDraft) {
    this.validate(draft);
    await this.db.execute(
      `UPDATE objectives SET name=$2,description=$3,category=$4,start_date=$5,target_date=$6,progress_mode=$7,progress_ref=$8,manual_current=$9,manual_target=$10,manual_unit=$11,body_baseline=$12,body_target=$13,updated_at=$14 WHERE id=$1`,
      [
        id,
        draft.name.trim(),
        draft.description.trim(),
        draft.category,
        draft.start_date,
        draft.target_date,
        draft.progress_mode,
        draft.progress_ref,
        draft.manual_current,
        draft.manual_target,
        draft.manual_unit.trim(),
        draft.body_baseline,
        draft.body_target,
        new Date().toISOString(),
      ],
    );
  }
  private validate(draft: ObjectiveDraft) {
    if (
      !draft.name.trim() ||
      draft.name.trim().length > 160 ||
      !objectiveCategories.includes(draft.category)
    )
      throw Error('Dados do objetivo inválidos.');
    if (
      !validDate(draft.start_date) ||
      (draft.target_date && (!validDate(draft.target_date) || draft.target_date < draft.start_date))
    )
      throw Error('Datas inválidas.');
    if (
      draft.progress_mode === 'manual' &&
      (!positive(draft.manual_target) ||
        draft.manual_target === null ||
        draft.manual_current === null ||
        draft.manual_current < 0 ||
        !Number.isFinite(draft.manual_current))
    )
      throw Error('Progresso manual inválido.');
    if (
      draft.progress_mode === 'body_metric' &&
      (!bodyMetrics.includes(draft.progress_ref as (typeof bodyMetrics)[number]) ||
        !positive(draft.body_baseline) ||
        !positive(draft.body_target))
    )
      throw Error('Indicador corporal inválido.');
    if (
      (draft.progress_mode === 'project' || draft.progress_mode === 'financial_goal') &&
      !draft.progress_ref
    )
      throw Error('Escolha uma fonte do progresso.');
  }
  async status(id: string, status: ObjectiveStatus) {
    if (!objectiveStatuses.includes(status)) throw Error('Status inválido.');
    const now = new Date().toISOString();
    await this.db.execute(
      `UPDATE objectives SET status=$2,completed_at=CASE WHEN $2='completed' THEN coalesce(completed_at,$3) ELSE NULL END,archived_at=CASE WHEN $2='archived' THEN coalesce(archived_at,$3) ELSE NULL END,updated_at=$3 WHERE id=$1`,
      [id, status, now],
    );
  }
  async links(objectiveId: string) {
    return this.db.select<ObjectiveLink[]>(
      `SELECT l.*,COALESCE(t.title,p.name,h.name,r.name,w.name,f.name,th.title,
        CASE l.entity_type WHEN 'activity' THEN 'Passos' WHEN 'nutrition' THEN 'Diário alimentar' WHEN 'body_metric' THEN 'Medida: '||l.entity_id END,'') name
       FROM objective_links l
       LEFT JOIN tasks t ON l.entity_type='task' AND t.id=l.entity_id
       LEFT JOIN projects p ON l.entity_type='project' AND p.id=l.entity_id
       LEFT JOIN habits h ON l.entity_type='habit' AND h.id=l.entity_id
       LEFT JOIN routines r ON l.entity_type='routine' AND r.id=l.entity_id
       LEFT JOIN workout_plans w ON l.entity_type='workout_plan' AND w.id=l.entity_id
       LEFT JOIN finance_goals f ON l.entity_type='financial_goal' AND f.id=l.entity_id
       LEFT JOIN thoughts th ON l.entity_type='thought' AND th.id=l.entity_id
       WHERE l.objective_id=$1 ORDER BY l.entity_type,name`,
      [objectiveId],
    );
  }
  async candidates(query: string, objectiveId: string) {
    const term = query.trim().slice(0, 80);
    if (!term) return [];
    return this.db.select<{ entity_type: ObjectiveLinkType; entity_id: string; name: string }[]>(
      `SELECT entity_type,entity_id,name FROM (
       SELECT 'task' entity_type,id entity_id,title name FROM tasks WHERE archived_at IS NULL
       UNION ALL SELECT 'project',id,name FROM projects WHERE archived_at IS NULL
       UNION ALL SELECT 'habit',id,name FROM habits WHERE archived_at IS NULL
       UNION ALL SELECT 'routine',id,name FROM routines WHERE archived_at IS NULL
       UNION ALL SELECT 'workout_plan',id,name FROM workout_plans WHERE archived_at IS NULL
       UNION ALL SELECT 'financial_goal',id,name FROM finance_goals WHERE archived_at IS NULL
       UNION ALL SELECT 'thought',id,COALESCE(NULLIF(title,''),'Pensamento') FROM thoughts WHERE archived_at IS NULL
       ) c WHERE instr(lower(name),lower($1))>0 AND NOT EXISTS
       (SELECT 1 FROM objective_links l WHERE l.objective_id=$2 AND l.entity_type=c.entity_type AND l.entity_id=c.entity_id)
       LIMIT 25`,
      [term, objectiveId],
    );
  }
  async link(objectiveId: string, entityType: ObjectiveLinkType, entityId: string) {
    if (!objectiveLinkTypes.includes(entityType)) throw Error('Tipo de vínculo inválido.');
    await this.db.execute(
      'INSERT OR IGNORE INTO objective_links(id,objective_id,entity_type,entity_id,created_at) VALUES($1,$2,$3,$4,$5)',
      [crypto.randomUUID(), objectiveId, entityType, entityId, new Date().toISOString()],
    );
  }
  async unlink(id: string, objectiveId: string) {
    await this.db.execute('DELETE FROM objective_links WHERE id=$1 AND objective_id=$2', [
      id,
      objectiveId,
    ]);
  }
  async createLinked(objectiveId: string, entityType: 'task' | 'project' | 'habit', title: string) {
    if (!title.trim()) throw Error('Informe um nome.');
    const id = crypto.randomUUID();
    await this.db.execute(
      'INSERT INTO objective_create_actions(id,objective_id,entity_type,title,created_at) VALUES($1,$2,$3,$4,$5)',
      [id, objectiveId, entityType, title.trim(), new Date().toISOString()],
    );
    return id;
  }
  updates(objectiveId: string) {
    return this.db.select<ObjectiveUpdate[]>(
      'SELECT * FROM objective_updates WHERE objective_id=$1 ORDER BY created_at DESC LIMIT 50',
      [objectiveId],
    );
  }
  async addUpdate(objectiveId: string, content: string) {
    if (!content.trim() || content.length > 2000) throw Error('Escreva uma atualização curta.');
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await this.db.execute(
      'INSERT INTO objective_updates(id,objective_id,content,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
      [id, objectiveId, content.trim(), now],
    );
    return id;
  }
  async progress(objective: Objective): Promise<ObjectiveProgress | null> {
    if (objective.progress_mode === 'none') return null;
    if (objective.progress_mode === 'manual')
      return {
        label: 'Progresso informado',
        current: objective.manual_current ?? 0,
        target: objective.manual_target,
        unit: objective.manual_unit,
        percent: percent(objective.manual_current ?? 0, objective.manual_target),
      };
    if (objective.progress_mode === 'project') {
      const [row] = await this.db.select<{ name: string; total: number; done: number }[]>(
        `SELECT p.name,COUNT(t.id) total,SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) done FROM projects p LEFT JOIN tasks t ON t.project_id=p.id AND t.archived_at IS NULL WHERE p.id=$1 GROUP BY p.id`,
        [objective.progress_ref],
      );
      return row
        ? {
            label: row.name,
            current: row.done ?? 0,
            target: row.total,
            unit: 'tarefas',
            percent: percent(row.done ?? 0, row.total),
          }
        : null;
    }
    if (objective.progress_mode === 'financial_goal') {
      const [privacy] = await this.db.select<{ hide_values: number }[]>(
        'SELECT hide_values FROM finance_preferences WHERE id=1',
      );
      if (privacy?.hide_values)
        return {
          label: 'Meta financeira',
          current: 0,
          target: null,
          unit: '',
          percent: null,
          hidden: true,
        };
      const [row] = await this.db.select<{ name: string; current: number; target: number }[]>(
        `SELECT g.name,g.initial_amount_cents+COALESCE(SUM(c.amount_cents),0) current,g.target_amount_cents target FROM finance_goals g LEFT JOIN finance_goal_contributions c ON c.goal_id=g.id WHERE g.id=$1 GROUP BY g.id`,
        [objective.progress_ref],
      );
      return row
        ? {
            label: row.name,
            current: row.current / 100,
            target: row.target / 100,
            unit: 'BRL',
            percent: percent(row.current, row.target),
          }
        : null;
    }
    const [row] = await this.db.select<{ value: number; unit: string }[]>(
      `SELECT value,unit FROM body_measurement_values WHERE metric_key=$1 ORDER BY record_date DESC LIMIT 1`,
      [objective.progress_ref],
    );
    if (!row) return null;
    const baseline = objective.body_baseline,
      target = objective.body_target;
    const p =
      baseline !== null && target !== null && baseline !== target
        ? Math.max(0, Math.min(100, ((row.value - baseline) / (target - baseline)) * 100))
        : null;
    return {
      label: objective.progress_ref ?? 'Medida',
      current: row.value,
      target,
      unit: row.unit,
      percent: p,
    };
  }
  async recent(limit = 3) {
    return this.db.select<Objective[]>(
      `SELECT * FROM objectives WHERE status='active' AND archived_at IS NULL ORDER BY updated_at DESC LIMIT $1`,
      [limit],
    );
  }
  async weekActivity(start: string, end: string, limit = 5) {
    const rows = await this.db.select<{ id: string; name: string; activities: number }[]>(
      `${milestoneReadSql} SELECT o.id,o.name,
      (SELECT COUNT(*) FROM milestone_read m WHERE m.objective_id=o.id AND m.effective_status='completed' AND m.achieved_date BETWEEN $1 AND $2)+
      (SELECT COUNT(*) FROM objective_updates u WHERE u.objective_id=o.id AND date(u.created_at,'localtime') BETWEEN $1 AND $2)+
      (SELECT COUNT(*) FROM task_completions c JOIN tasks t ON t.id=c.task_id WHERE c.occurrence_date BETWEEN $1 AND $2 AND EXISTS(SELECT 1 FROM objective_links l WHERE l.objective_id=o.id AND ((l.entity_type='task' AND l.entity_id=t.id) OR (l.entity_type='project' AND l.entity_id=t.project_id))))+
      (SELECT COUNT(*) FROM tasks t WHERE t.recurrence IS NULL AND t.status='completed' AND date(t.completed_at,'localtime') BETWEEN $1 AND $2 AND EXISTS(SELECT 1 FROM objective_links l WHERE l.objective_id=o.id AND ((l.entity_type='task' AND l.entity_id=t.id) OR (l.entity_type='project' AND l.entity_id=t.project_id))))+
      (SELECT COUNT(*) FROM habit_entries h JOIN objective_links l ON l.entity_type='habit' AND l.entity_id=h.habit_id AND l.objective_id=o.id WHERE h.entry_date BETWEEN $1 AND $2 AND h.value>0)+
      (SELECT COUNT(*) FROM routine_occurrences r JOIN objective_links l ON l.entity_type='routine' AND l.entity_id=r.routine_id AND l.objective_id=o.id WHERE r.occurrence_date BETWEEN $1 AND $2 AND r.completed_at IS NOT NULL)+
      (SELECT COUNT(*) FROM workout_sessions s JOIN objective_links l ON l.entity_type='workout_plan' AND l.entity_id=s.workout_plan_id AND l.objective_id=o.id WHERE s.status='completed' AND s.session_date BETWEEN $1 AND $2)+
      (SELECT COUNT(*) FROM finance_goal_contributions c JOIN objective_links l ON l.entity_type='financial_goal' AND l.entity_id=c.goal_id AND l.objective_id=o.id WHERE c.date BETWEEN $1 AND $2)+
      (SELECT COUNT(*) FROM daily_activity_entries a JOIN objective_links l ON l.entity_type='activity' AND l.entity_id='steps' AND l.objective_id=o.id WHERE a.entry_date BETWEEN $1 AND $2)+
      (SELECT COUNT(DISTINCT v.record_date) FROM body_measurement_values v JOIN objective_links l ON l.entity_type='body_metric' AND l.entity_id=v.metric_key AND l.objective_id=o.id WHERE v.record_date BETWEEN $1 AND $2)+
      (SELECT COUNT(DISTINCT d.entry_date) FROM food_diary_entries d JOIN objective_links l ON l.entity_type='nutrition' AND l.entity_id='diary' AND l.objective_id=o.id WHERE d.entry_date BETWEEN $1 AND $2) activities
      FROM objectives o WHERE o.archived_at IS NULL AND o.status!='archived'
      AND (EXISTS(SELECT 1 FROM objective_links l WHERE l.objective_id=o.id)
        OR EXISTS(SELECT 1 FROM objective_updates u WHERE u.objective_id=o.id AND date(u.created_at,'localtime') BETWEEN $1 AND $2)
        OR EXISTS(SELECT 1 FROM milestone_read m WHERE m.objective_id=o.id AND m.effective_status='completed' AND m.achieved_date BETWEEN $1 AND $2))
      ORDER BY activities DESC LIMIT $3`,
      [start, end, Math.max(1, Math.min(1000, limit))],
    );
    return rows.filter((row) => row.activities > 0);
  }
}

export const emptyObjectiveDraft = (): ObjectiveDraft => ({
  name: '',
  description: '',
  category: 'other',
  start_date: localDate(),
  target_date: null,
  progress_mode: 'none',
  progress_ref: null,
  manual_current: null,
  manual_target: null,
  manual_unit: '',
  body_baseline: null,
  body_target: null,
});
