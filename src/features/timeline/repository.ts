import type { SqlConnection } from '../../lib/database/connection';

export type TimelineGroup = 'organization' | 'health' | 'finance' | 'personal';
export interface TimelineEvent {
  id: string;
  event_type: string;
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

const eventReadModel = `
 SELECT a.id,a.event_type,a.source_type,a.source_id,a.event_date,a.occurred_at sort_at,
        a.title,a.summary,
        CASE
          WHEN a.source_type IN('habit','workout','nutrition','body') THEN 'health'
          WHEN a.source_type='finance' THEN 'finance'
          WHEN a.source_type='thought' THEN 'personal'
          ELSE 'organization'
        END group_name,
        CASE WHEN a.source_type='objective' THEN a.source_id WHEN a.related_type='objective' THEN a.related_id ELSE NULL END objective_id,
        CASE
          WHEN a.source_type='planning' THEN a.related_type
          WHEN a.source_type='focus' THEN a.related_type
          ELSE a.source_type
        END link_type,
        CASE
          WHEN a.source_type IN('planning','focus') THEN a.related_id
          ELSE a.source_id
        END link_id
 FROM activity_events a`;

// Historical domains not yet emitting activity remain visible through compact,
// read-only compatibility branches. Phase 2 actions are persisted in activity_events.
const compatibilityReadModel = `
 SELECT 'moment:'||n.id id,'moment.created' event_type,'moment' source_type,n.id source_id,
        n.event_date,n.event_date||'T'||time(n.created_at,'localtime') sort_at,
        n.title,n.content summary,'personal' group_name,n.objective_id,
        'moment' link_type,n.id link_id
 FROM timeline_notes n
 UNION ALL
 SELECT 'milestone:'||m.id,'milestone.completed',
        CASE WHEN m.mode='financial_goal' OR m.unit='BRL' THEN 'financial_goal' ELSE 'milestone' END,m.id,
        date(m.completed_at,'localtime'),
        replace(datetime(m.completed_at,'localtime'),' ','T'),'Marco concluído',
        m.title||' · Objetivo: '||o.name,'organization',m.objective_id,
        'objective',m.objective_id
 FROM objective_milestones m JOIN objectives o ON o.id=m.objective_id
 WHERE m.status='completed' AND m.completed_at IS NOT NULL
 UNION ALL
 SELECT 'routine:'||o.id,'routine.completed','routine',o.routine_id,o.occurrence_date,
        replace(datetime(o.completed_at,'localtime'),' ','T'),'Rotina concluída',r.name,
        'organization',NULL,'routine',r.id
 FROM routine_occurrences o JOIN routines r ON r.id=o.routine_id WHERE o.completed_at IS NOT NULL
 UNION ALL
 SELECT 'objective:'||o.id||':completed','objective.completed','objective',o.id,
        date(o.completed_at,'localtime'),replace(datetime(o.completed_at,'localtime'),' ','T'),
        'Objetivo concluído',o.name,'organization',o.id,'objective',o.id
 FROM objectives o WHERE o.completed_at IS NOT NULL AND o.deleted_at IS NULL
 UNION ALL
 SELECT 'steps:'||d.entry_date,'activity.steps','steps',d.entry_date,d.entry_date,
        d.entry_date||'T00:00:00','Passos registrados',CAST(d.steps AS TEXT)||' passos',
        'health',NULL,'activity','steps'
 FROM daily_activity_entries d`;

export class TimelineRepository {
  constructor(private db: SqlConnection) {}

  async page(filters: TimelineFilters): Promise<TimelinePage> {
    if (filters.from > filters.to) throw Error('Período inválido.');
    const limit = Math.max(1, Math.min(50, filters.limit ?? 40));
    const [privacy, finance] = await Promise.all([
      this.db.select<{ value: string }[]>(
        "SELECT value FROM settings WHERE key='timeline_private'",
      ),
      this.db.select<{ hide_values: number }[]>(
        'SELECT hide_values FROM finance_preferences WHERE id=1',
      ),
    ]);
    const privateMode = privacy[0]?.value === '1';
    const hideFinance = privateMode || Boolean(finance[0]?.hide_values);
    const rows = await this.db.select<TimelineEvent[]>(
      `SELECT e.* FROM (${eventReadModel} UNION ALL ${compatibilityReadModel}) e
       WHERE e.event_date BETWEEN $1 AND $2
       AND ($3 IS NULL OR e.sort_at<$3 OR (e.sort_at=$3 AND e.id<$4))
       AND ($5 IS NULL OR e.group_name=$5)
       AND ($6 IS NULL OR e.source_type=$6)
       AND ($7 IS NULL OR e.objective_id=$7
         OR EXISTS(SELECT 1 FROM objective_links l
           WHERE l.objective_id=$7 AND l.entity_type=e.link_type AND l.entity_id=e.link_id)
         OR (e.link_type='task' AND EXISTS(
           SELECT 1 FROM tasks t JOIN objective_links l
             ON l.entity_type='project' AND l.entity_id=t.project_id
           WHERE t.id=e.link_id AND l.objective_id=$7)))
       AND ($8 IS NULL OR instr(lower(e.title||' '||
         CASE WHEN ($9=1 AND e.source_type IN('thought','moment','focus','body'))
                    OR ($10=1 AND e.source_type IN('finance','financial_goal'))
              THEN '' ELSE e.summary END),lower($8))>0)
       ORDER BY e.sort_at DESC,e.id DESC LIMIT $11`,
      [
        filters.from,
        filters.to,
        filters.before?.sortAt ?? null,
        filters.before?.id ?? null,
        filters.group && filters.group !== 'all' ? filters.group : null,
        filters.source ?? null,
        filters.objectiveId ?? null,
        filters.query?.trim().slice(0, 100) || null,
        privateMode ? 1 : 0,
        hideFinance ? 1 : 0,
        limit + 1,
      ],
    );
    const events = rows.slice(0, limit).map((event) => {
      if (privateMode && ['thought', 'moment', 'focus', 'body'].includes(event.source_type))
        return {
          ...event,
          title: event.source_type === 'moment' ? 'Momento registrado' : event.title,
          summary: '',
        };
      if (hideFinance && ['finance', 'financial_goal'].includes(event.source_type))
        return { ...event, title: 'Transação financeira registrada', summary: '' };
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
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
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
