import type { SqlConnection } from '../../lib/database/connection';
import { addMinutes, scheduleTimes, validatePlanningDraft } from './domain';
import type {
  PlanningDraft,
  PlanningItem,
  PlanningSource,
  PlanningSourceOption,
  PlanningStatus,
} from './domain';

export interface PlanningTemplate {
  id: string;
  name: string;
  description: string;
  default_mode: 'single' | 'expanded';
  active: number;
  legacy_routine_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface PlanningTemplateItem {
  id: string;
  template_id: string;
  title: string;
  relative_minutes: number | null;
  duration_minutes: number;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PlanningChecklistItem {
  id: string;
  planning_id: string;
  title: string;
  position: number;
  completed: number;
}

const itemSelect = `SELECT b.*,
 coalesce(nullif(t.title,''),nullif(sp.name,''),nullif(h.name,''),nullif(w.name,''),nullif(pt.name,''),nullif(e.summary,''),nullif(b.title_snapshot,''),nullif(b.title,''),'Planejamento') display_title,
 coalesce(tp.name,sp.name) project_name,
 CASE b.source_type
  WHEN 'standalone' THEN 1
  WHEN 'task' THEN coalesce(t.archived_at IS NULL AND t.status='pending',0)
  WHEN 'project' THEN coalesce(sp.archived_at IS NULL AND sp.status='active',0)
  WHEN 'habit' THEN coalesce(h.archived_at IS NULL AND h.active=1,0)
  WHEN 'workout' THEN coalesce(w.id IS NOT NULL,0)
  WHEN 'template' THEN coalesce(pt.archived_at IS NULL AND pt.active=1,0)
  WHEN 'event' THEN coalesce(e.id IS NOT NULL,0)
  ELSE 0 END source_active
 FROM planner_time_blocks b
 LEFT JOIN tasks t ON b.source_type='task' AND t.id=b.source_id
 LEFT JOIN projects tp ON tp.id=t.project_id
 LEFT JOIN projects sp ON b.source_type='project' AND sp.id=b.source_id
 LEFT JOIN habits h ON b.source_type='habit' AND h.id=b.source_id
 LEFT JOIN workout_days w ON b.source_type='workout' AND w.id=b.source_id
 LEFT JOIN planning_templates pt ON b.source_type='template' AND pt.id=b.source_id
 LEFT JOIN external_calendar_events e ON b.source_type='event' AND e.id=b.source_id`;

export class PlanningRepository {
  constructor(private db: SqlConnection) {}

  list(from: string, to: string) {
    return this.db.select<PlanningItem[]>(
      `${itemSelect} WHERE b.block_date BETWEEN $1 AND $2
       ORDER BY b.block_date,
       CASE b.schedule_kind WHEN 'fixed' THEN 0 WHEN 'period' THEN 1 ELSE 2 END,
       b.start_time,b.position,b.created_at,b.id`,
      [from, to],
    );
  }

  async get(id: string) {
    return (await this.db.select<PlanningItem[]>(`${itemSelect} WHERE b.id=$1`, [id]))[0] ?? null;
  }

  async sourceOptions(type: 'task' | 'project', query = ''): Promise<PlanningSourceOption[]> {
    const search = `%${query.trim()}%`;
    if (type === 'task')
      return (
        await this.db.select<{ id: string; name: string; detail: string }[]>(
          `SELECT t.id,t.title name,coalesce(p.name,'Sem projeto') detail FROM tasks t
           LEFT JOIN projects p ON p.id=t.project_id
           WHERE t.archived_at IS NULL AND t.status='pending' AND t.title LIKE $1
           ORDER BY t.priority='high' DESC,t.due_date IS NULL,t.due_date,t.sort_order,t.created_at LIMIT 100`,
          [search],
        )
      ).map((row) => ({ ...row, type: 'task' }));
    return (
      await this.db.select<{ id: string; name: string; detail: string }[]>(
        `SELECT id,name,coalesce(target_date,'Sem prazo') detail FROM projects
         WHERE archived_at IS NULL AND status='active' AND name LIKE $1
         ORDER BY sort_order,created_at LIMIT 100`,
        [search],
      )
    ).map((row) => ({ ...row, type: 'project' }));
  }

  async auxiliarySources(day: string): Promise<PlanningSourceOption[]> {
    const [habits, workouts, events, templates] = await Promise.all([
      this.db.select<{ id: string; name: string; detail: string }[]>(
        `SELECT id,name,CASE tracking_type WHEN 'check' THEN 'Check' WHEN 'quantity' THEN unit WHEN 'duration' THEN unit ELSE weekly_target||'× por semana' END detail
         FROM habits WHERE archived_at IS NULL AND active=1 ORDER BY sort_order,created_at`,
      ),
      this.db.select<{ id: string; name: string; detail: string }[]>(
        `SELECT d.id,d.name,p.name detail FROM workout_days d JOIN workout_plans p ON p.id=d.workout_plan_id
         WHERE p.archived_at IS NULL ORDER BY p.sort_order,d.sort_order`,
      ),
      this.db.select<{ id: string; name: string; detail: string }[]>(
        `SELECT id,summary name,coalesce(start_time,'Dia todo') detail FROM external_calendar_events
         WHERE start_date=$1 ORDER BY start_time,id`,
        [day],
      ),
      this.db.select<{ id: string; name: string; detail: string }[]>(
        `SELECT id,name,CASE default_mode WHEN 'single' THEN 'Bloco único' ELSE 'Expandir itens' END detail
         FROM planning_templates WHERE archived_at IS NULL AND active=1 ORDER BY sort_order,created_at`,
      ),
    ]);
    return [
      ...habits.map((row) => ({ ...row, type: 'habit' as const })),
      ...workouts.map((row) => ({ ...row, type: 'workout' as const })),
      ...events.map((row) => ({ ...row, type: 'event' as const })),
      ...templates.map((row) => ({ ...row, type: 'template' as const })),
    ];
  }

  private async sourceTitle(type: PlanningSource, id: string | null, fallback: string) {
    if (type === 'standalone' || !id) return fallback;
    const definitions: Partial<Record<PlanningSource, [string, string]>> = {
      task: ['tasks', 'title'],
      project: ['projects', 'name'],
      habit: ['habits', 'name'],
      workout: ['workout_days', 'name'],
      event: ['external_calendar_events', 'summary'],
      template: ['planning_templates', 'name'],
    };
    const definition = definitions[type];
    if (!definition) return fallback;
    const [table, column] = definition;
    const rows = await this.db.select<{ name: string }[]>(
      `SELECT ${column} name FROM ${table} WHERE id=$1`,
      [id],
    );
    if (!rows[0]) throw Error('A origem selecionada não está mais disponível.');
    return rows[0].name;
  }

  async save(input: PlanningDraft, id?: string) {
    const draft = validatePlanningDraft(input);
    const [start, end] = scheduleTimes(draft);
    const title = id
      ? draft.title
      : await this.sourceTitle(draft.sourceType, draft.sourceId, draft.title);
    const now = new Date().toISOString();
    if (id) {
      await this.db.execute(
        `UPDATE planner_time_blocks SET block_date=$2,start_time=$3,end_time=$4,schedule_kind=$5,
         day_period=$6,title=$7,title_snapshot=$7,notes=$8,updated_at=$9 WHERE id=$1`,
        [id, draft.date, start, end, draft.schedule, draft.dayPeriod, title, draft.notes, now],
      );
      return id;
    }
    const key = crypto.randomUUID();
    const legacyType = ['task', 'habit', 'workout'].includes(draft.sourceType)
      ? draft.sourceType
      : null;
    await this.db.execute(
      `INSERT INTO planner_time_blocks(
       id,block_date,start_time,end_time,entity_type,entity_id,occurrence_date,title,notes,
       created_at,updated_at,schedule_kind,day_period,position,status,title_snapshot,source_type,source_id
       ) VALUES($1,$2,$3,$4,$5,$6,$2,$7,$8,$9,$9,$10,$11,
       coalesce((SELECT max(position)+1 FROM planner_time_blocks WHERE block_date=$2 AND schedule_kind=$10 AND coalesce(day_period,'')=coalesce($11,'')),0),
       'planned',$7,$12,$13)`,
      [
        key,
        draft.date,
        start,
        end,
        legacyType,
        legacyType ? draft.sourceId : null,
        title,
        draft.notes,
        now,
        draft.schedule,
        draft.dayPeriod,
        draft.sourceType,
        draft.sourceId,
      ],
    );
    return key;
  }

  async setStatus(id: string, status: PlanningStatus) {
    const now = new Date().toISOString();
    await this.db.execute(
      `UPDATE planner_time_blocks SET status=$2,completed_at=CASE WHEN $2='completed' THEN $3 ELSE NULL END,
       updated_at=$3 WHERE id=$1`,
      [id, status, now],
    );
  }

  async remove(id: string) {
    await this.db.execute('DELETE FROM planner_time_blocks WHERE id=$1', [id]);
  }

  async move(id: string, date: string) {
    const item = await this.get(id);
    if (!item) throw Error('Item não encontrado.');
    return this.save(
      {
        date,
        title: item.display_title,
        notes: item.notes,
        schedule: item.schedule_kind,
        startTime: item.start_time,
        endTime: item.end_time,
        dayPeriod: item.day_period,
        sourceType: item.source_type,
        sourceId: item.source_id,
      },
      id,
    );
  }

  async duplicate(id: string, date: string) {
    const item = await this.get(id);
    if (!item) throw Error('Item não encontrado.');
    return this.save({
      date,
      title: item.display_title,
      notes: item.notes,
      schedule: item.schedule_kind,
      startTime: item.start_time,
      endTime: item.end_time,
      dayPeriod: item.day_period,
      sourceType: item.source_type,
      sourceId: item.source_id,
    });
  }

  async reorder(id: string, direction: -1 | 1) {
    const current = await this.get(id);
    if (!current) return;
    const rows = (await this.list(current.block_date, current.block_date)).filter(
      (item) =>
        item.schedule_kind === current.schedule_kind && item.day_period === current.day_period,
    );
    const index = rows.findIndex((item) => item.id === id);
    const other = rows[index + direction];
    if (!other) return;
    const now = new Date().toISOString();
    await this.db.execute(
      `UPDATE planner_time_blocks SET position=CASE id WHEN $1 THEN $2 WHEN $3 THEN $4 END,updated_at=$5 WHERE id IN($1,$3)`,
      [id, other.position, other.id, current.position, now],
    );
  }

  checklist(id: string) {
    return this.db.select<PlanningChecklistItem[]>(
      'SELECT * FROM planning_item_checklist WHERE planning_id=$1 ORDER BY position,created_at',
      [id],
    );
  }

  async toggleChecklist(id: string, completed: boolean) {
    await this.db.execute(
      'UPDATE planning_item_checklist SET completed=$2,updated_at=$3 WHERE id=$1',
      [id, completed ? 1 : 0, new Date().toISOString()],
    );
  }

  templates() {
    return this.db.select<PlanningTemplate[]>(
      'SELECT * FROM planning_templates WHERE archived_at IS NULL ORDER BY sort_order,created_at',
    );
  }

  templateItems(id: string) {
    return this.db.select<PlanningTemplateItem[]>(
      'SELECT * FROM planning_template_items WHERE template_id=$1 ORDER BY position,created_at',
      [id],
    );
  }

  async saveTemplate(
    input: Pick<PlanningTemplate, 'name' | 'description' | 'default_mode' | 'active'>,
    id?: string,
  ) {
    const name = input.name.trim();
    if (!name || name.length > 500) throw Error('Informe um nome de até 500 caracteres.');
    const now = new Date().toISOString();
    const key = id ?? crypto.randomUUID();
    await this.db.execute(
      id
        ? `UPDATE planning_templates SET name=$1,description=$2,default_mode=$3,active=$4,updated_at=$5 WHERE id=$6`
        : `INSERT INTO planning_templates(name,description,default_mode,active,updated_at,id,created_at) VALUES($1,$2,$3,$4,$5,$6,$5)`,
      [name, input.description.trim(), input.default_mode, input.active ? 1 : 0, now, key],
    );
    return key;
  }

  async addTemplateItem(templateId: string, title: string) {
    if (!title.trim()) throw Error('Informe o item.');
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO planning_template_items(id,template_id,title,position,created_at,updated_at)
       VALUES($1,$2,$3,coalesce((SELECT max(position)+1 FROM planning_template_items WHERE template_id=$2),0),$4,$4)`,
      [crypto.randomUUID(), templateId, title.trim(), now],
    );
  }

  async removeTemplateItem(id: string) {
    await this.db.execute('DELETE FROM planning_template_items WHERE id=$1', [id]);
  }

  async archiveTemplate(id: string) {
    const now = new Date().toISOString();
    await this.db.execute(
      'UPDATE planning_templates SET archived_at=$2,active=0,updated_at=$2 WHERE id=$1',
      [id, now],
    );
  }

  async applyTemplate(
    templateId: string,
    date: string,
    mode: 'single' | 'expanded',
    startTime: string | null = null,
  ) {
    const template = (await this.templates()).find((item) => item.id === templateId);
    if (!template) throw Error('Modelo não encontrado.');
    const items = await this.templateItems(templateId);
    if (mode === 'single') {
      const planningId = await this.save({
        date,
        title: template.name,
        notes: template.description,
        schedule: startTime ? 'fixed' : 'flexible',
        startTime,
        endTime: startTime ? addMinutes(startTime, 30) : null,
        dayPeriod: null,
        sourceType: 'template',
        sourceId: templateId,
      });
      const now = new Date().toISOString();
      for (const item of items)
        await this.db.execute(
          `INSERT INTO planning_item_checklist(id,planning_id,title,position,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)`,
          [crypto.randomUUID(), planningId, item.title, item.position, now],
        );
      return [planningId];
    }
    const created: string[] = [];
    let offset = 0;
    for (const item of items) {
      const relative = item.relative_minutes ?? offset;
      const itemStart = startTime ? addMinutes(startTime, relative) : null;
      created.push(
        await this.save({
          date,
          title: item.title,
          notes: `Modelo: ${template.name}`,
          schedule: itemStart ? 'fixed' : 'flexible',
          startTime: itemStart,
          endTime: itemStart ? addMinutes(itemStart, item.duration_minutes) : null,
          dayPeriod: null,
          sourceType: 'template',
          sourceId: templateId,
        }),
      );
      offset = relative + item.duration_minutes;
    }
    return created;
  }
}
