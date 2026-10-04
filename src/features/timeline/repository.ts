import type { SqlConnection } from '../../lib/database/connection';
import { milestoneReadSql } from '../objectives/milestones-repository';

export type TimelineGroup = 'organization' | 'health' | 'finance' | 'personal';
export interface TimelineEvent {
  id: string;
  source_type: string;
  source_id: string;
  event_date: string;
  sort_at: string;
  title: string;
  summary: string;
  group_name: TimelineGroup;
  objective_id: string | null;
  link_type: string | null;
  link_id: string | null;
}
export interface TimelineFilters {
  from: string;
  to: string;
  group?: TimelineGroup | 'all';
  source?: string;
  objectiveId?: string;
  query?: string;
  before?: { sortAt: string; id: string };
  limit?: number;
}
export interface TimelinePage {
  events: TimelineEvent[];
  next: { sortAt: string; id: string } | null;
}

// Every branch projects the same read model. Source tables retain ownership of the data.
const branches = [
  `SELECT 'milestone:'||m.id id,'milestone' source_type,m.id source_id,m.achieved_date event_date,m.achieved_date||'T00:00:00' sort_at,'Marco concluído' title,CASE WHEN $10=1 OR ($11=1 AND (m.mode='financial_goal' OR m.unit='BRL')) THEN '' ELSE m.title||' · Objetivo: '||m.objective_name END summary,'organization' group_name,m.objective_id objective_id,NULL link_type,NULL link_id FROM (${milestoneReadSql} SELECT * FROM milestone_read) m WHERE m.effective_status='completed' AND m.achieved_date BETWEEN $1 AND $2`,
  `SELECT 'focus:'||s.id id,'focus' source_type,s.id source_id,date(s.ended_at,'localtime') event_date,replace(datetime(s.ended_at,'localtime'),' ','T') sort_at,'Sessão de foco concluída' title,s.title||' · '||CAST(s.focused_seconds/60 AS TEXT)||' min' summary,'organization' group_name,s.objective_id objective_id,CASE WHEN s.task_id IS NOT NULL THEN 'task' ELSE NULL END link_type,s.task_id link_id FROM focus_sessions s WHERE s.status='completed' AND date(s.ended_at,'localtime') BETWEEN $1 AND $2`,
  `SELECT 'task:'||t.id||':completed' id,'task' source_type,t.id source_id,date(t.completed_at,'localtime') event_date,replace(datetime(t.completed_at,'localtime'),' ','T') sort_at,'Tarefa concluída' title,t.title summary,'organization' group_name,NULL objective_id,'task' link_type,t.id link_id FROM tasks t WHERE t.status='completed' AND t.recurrence IS NULL AND t.completed_at IS NOT NULL AND date(t.completed_at,'localtime') BETWEEN $1 AND $2`,
  `SELECT 'task:'||c.task_id||':'||c.occurrence_date id,'task' source_type,c.task_id source_id,c.occurrence_date event_date,c.occurrence_date||'T00:00:00' sort_at,'Tarefa concluída' title,t.title summary,'organization' group_name,NULL objective_id,'task' link_type,t.id link_id FROM task_completions c JOIN tasks t ON t.id=c.task_id WHERE c.occurrence_date BETWEEN $1 AND $2`,
  `SELECT 'project:'||p.id||':created' id,'project' source_type,p.id source_id,date(p.created_at,'localtime') event_date,replace(datetime(p.created_at,'localtime'),' ','T') sort_at,'Projeto criado' title,p.name summary,'organization' group_name,NULL objective_id,'project' link_type,p.id link_id FROM projects p WHERE date(p.created_at,'localtime') BETWEEN $1 AND $2`,
  `SELECT 'project:'||p.id||':completed' id,'project' source_type,p.id source_id,date(p.completed_at,'localtime') event_date,replace(datetime(p.completed_at,'localtime'),' ','T') sort_at,'Projeto concluído' title,p.name summary,'organization' group_name,NULL objective_id,'project' link_type,p.id link_id FROM projects p WHERE p.completed_at IS NOT NULL AND date(p.completed_at,'localtime') BETWEEN $1 AND $2`,
  `SELECT 'habit:'||h.entry_date id,'habit' source_type,h.entry_date source_id,h.entry_date event_date,h.entry_date||'T00:00:00' sort_at,'Hábitos registrados' title,CAST(COUNT(*) AS TEXT)||' hábitos' summary,'health' group_name,NULL objective_id,'habit_day' link_type,h.entry_date link_id FROM habit_entries h WHERE h.entry_date BETWEEN $1 AND $2 AND h.value>0 AND ($7 IS NULL OR EXISTS(SELECT 1 FROM objective_links l WHERE l.objective_id=$7 AND l.entity_type='habit' AND l.entity_id=h.habit_id)) GROUP BY h.entry_date`,
  `SELECT 'routine:'||o.id id,'routine' source_type,o.routine_id source_id,o.occurrence_date event_date,replace(datetime(o.completed_at,'localtime'),' ','T') sort_at,'Rotina concluída' title,r.name summary,'organization' group_name,NULL objective_id,'routine' link_type,r.id link_id FROM routine_occurrences o JOIN routines r ON r.id=o.routine_id WHERE o.completed_at IS NOT NULL AND o.occurrence_date BETWEEN $1 AND $2`,
  `SELECT 'workout:'||s.id id,'workout' source_type,s.id source_id,s.session_date event_date,replace(datetime(s.finished_at,'localtime'),' ','T') sort_at,'Treino concluído' title,s.day_name summary,'health' group_name,NULL objective_id,'workout_plan' link_type,s.workout_plan_id link_id FROM workout_sessions s WHERE s.status='completed' AND s.session_date BETWEEN $1 AND $2`,
  `SELECT 'body:'||r.measurement_date id,'body' source_type,r.measurement_date source_id,r.measurement_date event_date,r.measurement_date||'T00:00:00' sort_at,'Progresso corporal registrado' title,group_concat(CASE v.metric_key WHEN 'weight' THEN 'Peso' WHEN 'waist' THEN 'Cintura' ELSE 'Medida' END||' '||replace(printf('%.1f',v.value),'.',',')||' '||v.unit,' · ') summary,'health' group_name,NULL objective_id,'body_day' link_type,r.measurement_date link_id FROM body_measurement_records r JOIN body_measurement_values v ON v.record_date=r.measurement_date WHERE r.measurement_date BETWEEN $1 AND $2 AND ($7 IS NULL OR EXISTS(SELECT 1 FROM objective_links l WHERE l.objective_id=$7 AND l.entity_type='body_metric' AND l.entity_id=v.metric_key)) GROUP BY r.measurement_date`,
  `SELECT 'steps:'||a.entry_date id,'steps' source_type,a.entry_date source_id,a.entry_date event_date,a.entry_date||'T00:00:00' sort_at,'Passos registrados' title,CAST(a.steps AS TEXT)||' passos' summary,'health' group_name,NULL objective_id,'activity' link_type,'steps' link_id FROM daily_activity_entries a WHERE a.entry_date BETWEEN $1 AND $2`,
  `SELECT 'nutrition:'||d.entry_date id,'nutrition' source_type,d.entry_date source_id,d.entry_date event_date,d.entry_date||'T00:00:00' sort_at,'Diário alimentar atualizado' title,CAST(ROUND(SUM(COALESCE(CAST(json_extract(d.nutrients_json,'$.energy_kcal') AS REAL),0))) AS TEXT)||' kcal registradas' summary,'health' group_name,NULL objective_id,'nutrition' link_type,'diary' link_id FROM food_diary_entries d WHERE d.entry_date BETWEEN $1 AND $2 GROUP BY d.entry_date`,
  `SELECT 'finance:'||f.id id,'finance' source_type,f.id source_id,f.date event_date,f.date||'T00:00:00' sort_at,CASE f.transaction_type WHEN 'income' THEN 'Receita registrada' WHEN 'expense' THEN 'Despesa registrada' ELSE 'Transferência registrada' END title,f.description summary,'finance' group_name,NULL objective_id,'finance_transaction' link_type,f.id link_id FROM finance_transactions f WHERE f.date BETWEEN $1 AND $2`,
  `SELECT 'contribution:'||c.id id,'financial_goal' source_type,c.goal_id source_id,c.date event_date,c.date||'T00:00:00' sort_at,'Aporte registrado' title,g.name summary,'finance' group_name,NULL objective_id,'financial_goal' link_type,g.id link_id FROM finance_goal_contributions c JOIN finance_goals g ON g.id=c.goal_id WHERE c.date BETWEEN $1 AND $2`,
  `SELECT 'objective:'||o.id||':created' id,'objective' source_type,o.id source_id,date(o.created_at,'localtime') event_date,replace(datetime(o.created_at,'localtime'),' ','T') sort_at,'Objetivo criado' title,o.name summary,'organization' group_name,o.id objective_id,NULL link_type,NULL link_id FROM objectives o WHERE date(o.created_at,'localtime') BETWEEN $1 AND $2`,
  `SELECT 'objective:'||o.id||':completed' id,'objective' source_type,o.id source_id,date(o.completed_at,'localtime') event_date,replace(datetime(o.completed_at,'localtime'),' ','T') sort_at,'Objetivo concluído' title,o.name summary,'organization' group_name,o.id objective_id,NULL link_type,NULL link_id FROM objectives o WHERE o.completed_at IS NOT NULL AND date(o.completed_at,'localtime') BETWEEN $1 AND $2`,
  `SELECT 'objective-update:'||u.id id,'objective_update' source_type,u.objective_id source_id,date(u.created_at,'localtime') event_date,replace(datetime(u.created_at,'localtime'),' ','T') sort_at,'Atualização do objetivo' title,substr(u.content,1,160) summary,'personal' group_name,u.objective_id objective_id,NULL link_type,NULL link_id FROM objective_updates u WHERE date(u.created_at,'localtime') BETWEEN $1 AND $2`,
  `SELECT 'thought:'||t.id id,'thought' source_type,t.id source_id,date(t.created_at,'localtime') event_date,replace(datetime(t.created_at,'localtime'),' ','T') sort_at,'Pensamento criado' title,COALESCE(NULLIF(t.title,''),'Novo pensamento') summary,'personal' group_name,NULL objective_id,'thought' link_type,t.id link_id FROM thoughts t WHERE date(t.created_at,'localtime') BETWEEN $1 AND $2`,
  `SELECT 'moment:'||n.id id,'moment' source_type,n.id source_id,n.event_date event_date,n.event_date||'T'||time(n.created_at,'localtime') sort_at,n.title title,n.content summary,'personal' group_name,n.objective_id objective_id,NULL link_type,NULL link_id FROM timeline_notes n WHERE n.event_date BETWEEN $1 AND $2`,
];

export class TimelineRepository {
  constructor(private db: SqlConnection) {}
  async page(filters: TimelineFilters): Promise<TimelinePage> {
    if (filters.from > filters.to) throw Error('Período inválido.');
    const limit = Math.max(1, Math.min(50, filters.limit ?? 40));
    const privacy = await this.db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key='timeline_private'",
    );
    const finance = await this.db.select<{ hide_values: number }[]>(
      'SELECT hide_values FROM finance_preferences WHERE id=1',
    );
    const privateMode = privacy[0]?.value === '1';
    const hideFinance = privateMode || Boolean(finance[0]?.hide_values);
    const rows = await this.db.select<TimelineEvent[]>(
      `SELECT e.* FROM (${branches.join('\nUNION ALL\n')}) e
       WHERE ($3 IS NULL OR e.sort_at<$3 OR (e.sort_at=$3 AND e.id<$4))
       AND ($5 IS NULL OR e.group_name=$5)
       AND ($6 IS NULL OR e.source_type=$6)
       AND ($7 IS NULL OR e.objective_id=$7
            OR EXISTS(SELECT 1 FROM objective_links l WHERE l.objective_id=$7 AND l.entity_type=e.link_type AND l.entity_id=e.link_id)
            OR (e.source_type='task' AND EXISTS(SELECT 1 FROM tasks t JOIN objective_links l ON l.entity_type='project' AND l.entity_id=t.project_id AND l.objective_id=$7 WHERE t.id=e.source_id))
            OR (e.link_type='habit_day' AND EXISTS(SELECT 1 FROM habit_entries h JOIN objective_links l ON l.entity_type='habit' AND l.entity_id=h.habit_id AND l.objective_id=$7 WHERE h.entry_date=e.event_date AND h.value>0))
            OR (e.link_type='body_day' AND EXISTS(SELECT 1 FROM body_measurement_values v JOIN objective_links l ON l.entity_type='body_metric' AND l.entity_id=v.metric_key AND l.objective_id=$7 WHERE v.record_date=e.event_date)))
       AND ($8 IS NULL OR instr(lower(
         CASE WHEN $10=1 AND e.source_type='moment' THEN 'Momento registrado'
              WHEN $10=1 AND e.source_type='body' THEN 'Progresso corporal atualizado'
              WHEN $11=1 AND e.source_type='finance' THEN 'Transação financeira registrada'
              WHEN $11=1 AND e.source_type='financial_goal' THEN 'Aporte registrado'
              ELSE e.title END || ' ' ||
         CASE WHEN ($10=1 AND e.source_type IN ('body','thought','objective_update','moment','focus'))
                OR ($11=1 AND e.source_type IN ('finance','financial_goal'))
              THEN '' ELSE e.summary END),lower($8))>0)
       ORDER BY e.sort_at DESC,e.id DESC LIMIT $9`,
      [
        filters.from,
        filters.to,
        filters.before?.sortAt ?? null,
        filters.before?.id ?? null,
        filters.group && filters.group !== 'all' ? filters.group : null,
        filters.source ?? null,
        filters.objectiveId ?? null,
        filters.query?.trim().slice(0, 100) || null,
        limit + 1,
        privateMode ? 1 : 0,
        hideFinance ? 1 : 0,
      ],
    );
    const events = rows.slice(0, limit).map((event) => {
      if (privateMode && event.source_type === 'body')
        return { ...event, title: 'Progresso corporal atualizado', summary: '' };
      if (privateMode && event.source_type === 'thought') return { ...event, summary: '' };
      if (privateMode && event.source_type === 'focus') return { ...event, summary: '' };
      if (privateMode && event.source_type === 'objective_update') return { ...event, summary: '' };
      if (privateMode && event.source_type === 'moment')
        return { ...event, title: 'Momento registrado', summary: '' };
      if (
        hideFinance &&
        (event.source_type === 'finance' || event.source_type === 'financial_goal')
      )
        return {
          ...event,
          title:
            event.source_type === 'finance'
              ? 'Transação financeira registrada'
              : 'Aporte registrado',
          summary: '',
        };
      return event;
    });
    const last = events.at(-1);
    return {
      events,
      next: rows.length > limit && last ? { sortAt: last.sort_at, id: last.id } : null,
    };
  }
  async saveNote(
    eventDate: string,
    title: string,
    content: string,
    objectiveId: string | null = null,
  ) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
      !title.trim() ||
      title.length > 160 ||
      content.length > 4000
    )
      throw Error('Momento inválido.');
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await this.db.execute(
      'INSERT INTO timeline_notes(id,event_date,title,content,objective_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)',
      [id, eventDate, title.trim(), content.trim(), objectiveId, now],
    );
    return id;
  }
  async privateMode() {
    const rows = await this.db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key='timeline_private'",
    );
    return rows[0]?.value === '1';
  }
  async setPrivateMode(value: boolean) {
    await this.db.execute(
      "INSERT INTO settings(key,value,updated_at) VALUES('timeline_private',$1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      [value ? '1' : '0', new Date().toISOString()],
    );
  }
}
