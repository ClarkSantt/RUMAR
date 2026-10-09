import type { SqlConnection } from '../../lib/database/connection';

export type SearchPage =
  | 'tasks'
  | 'projects'
  | 'inbox'
  | 'habits'
  | 'routines'
  | 'thoughts'
  | 'workouts'
  | 'nutrition'
  | 'finance'
  | 'objectives'
  | 'timeline';
export interface SearchResult {
  id: string;
  title: string;
  detail: string;
  group: string;
  page: SearchPage;
  contextId?: string;
}
const sources: {
  table: string;
  title: string;
  detail: string;
  condition: string;
  group: string;
  page: SearchPage;
  context?: string;
}[] = [
  {
    table: 'objective_milestones',
    title:
      "CASE WHEN $2=1 AND (mode='financial_goal' OR unit='BRL') THEN 'Marco financeiro' ELSE title END",
    detail:
      "CASE WHEN $2=1 AND (mode='financial_goal' OR unit='BRL') THEN '' ELSE (SELECT name FROM objectives WHERE id=objective_id) END",
    context: 'objective_id',
    condition: "objective_id IN(SELECT id FROM objectives WHERE status!='archived')",
    group: 'Marcos',
    page: 'objectives',
  },
  {
    table: 'tasks',
    title: 'title',
    detail: 'description',
    condition: 'archived_at IS NULL',
    group: 'Tarefas',
    page: 'tasks',
  },
  {
    table: 'projects',
    title: 'name',
    detail: 'description',
    condition: 'archived_at IS NULL',
    group: 'Projetos',
    page: 'projects',
  },
  {
    table: 'objectives',
    title: 'name',
    detail: 'description',
    condition: "status<>'archived'",
    group: 'Objetivos',
    page: 'objectives',
  },
  {
    table: 'timeline_notes',
    title: 'title',
    detail: "''",
    condition: '1=1',
    group: 'Momentos',
    page: 'timeline',
  },
  {
    table: 'inbox_items',
    title: 'content',
    detail: "''",
    condition: "status='pending'",
    group: 'Inbox',
    page: 'inbox',
  },
  {
    table: 'habits',
    title: 'name',
    detail: 'description',
    condition: 'archived_at IS NULL',
    group: 'Hábitos',
    page: 'habits',
  },
  {
    table: 'routines',
    title: 'name',
    detail: 'description',
    condition: 'archived_at IS NULL',
    group: 'Rotinas',
    page: 'routines',
  },
  {
    table: 'thoughts',
    title: "COALESCE(NULLIF(title,''),substr(content,1,80))",
    detail: 'content',
    condition: 'archived_at IS NULL',
    group: 'Pensamentos',
    page: 'thoughts',
  },
  {
    table: 'workout_plans',
    title: 'name',
    detail: 'description',
    condition: 'archived_at IS NULL',
    group: 'Planos de treino',
    page: 'workouts',
  },
  {
    table: 'exercises',
    title: 'name',
    detail: 'muscle_group',
    condition: 'archived_at IS NULL',
    group: 'Exercícios',
    page: 'workouts',
  },
  {
    table: 'workout_sessions',
    title: 'day_name',
    detail: 'plan_name',
    condition: "status<>'discarded'",
    group: 'Sessões',
    page: 'workouts',
  },
  {
    table: 'foods',
    title: 'name',
    detail: "''",
    condition: 'archived_at IS NULL',
    group: 'Alimentos',
    page: 'nutrition',
  },
  {
    table: 'meals',
    title: 'name',
    detail: "''",
    condition: 'archived_at IS NULL',
    group: 'Refeições',
    page: 'nutrition',
  },
  {
    table: 'diet_plans',
    title: 'name',
    detail: 'description',
    condition: 'archived_at IS NULL',
    group: 'Dietas',
    page: 'nutrition',
  },
  {
    table: 'finance_transactions',
    title: 'description',
    detail: 'date',
    condition: '1=1',
    group: 'Transações',
    page: 'finance',
  },
  {
    table: 'finance_goals',
    title: 'name',
    detail: "''",
    condition: 'archived_at IS NULL',
    group: 'Objetivos financeiros',
    page: 'finance',
  },
];

export async function globalSearch(db: SqlConnection, query: string): Promise<SearchResult[]> {
  const term = query.trim().slice(0, 100);
  if (term.length < 2) return [];
  const privacy = await db.select<{ hide_values: number }[]>(
    'SELECT hide_values FROM finance_preferences WHERE id=1',
  );
  const privateRows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key='timeline_private'",
  );
  const hidden = Boolean(privacy[0]?.hide_values) || privateRows[0]?.value === '1';
  const batches = await Promise.all(
    sources.map(async (source) => {
      const rows = await db.select<
        { id: string; title: string; detail: string; contextId?: string }[]
      >(
        `SELECT id,${source.title} AS title,substr(${source.detail},1,120) AS detail${source.context ? `,${source.context} contextId` : ''} FROM ${source.table}
       WHERE ${source.condition} AND (instr(lower(${source.title}),lower($1))>0 OR instr(lower(${source.detail}),lower($1))>0)
       ORDER BY CASE WHEN lower(${source.title})=lower($1) THEN 0 WHEN lower(${source.title}) LIKE lower($1)||'%' THEN 1 ELSE 2 END, title LIMIT 5`,
        source.context ? [term, Number(hidden)] : [term],
      );
      return rows.map((row) => ({
        ...row,
        title:
          hidden && source.page === 'finance'
            ? source.group === 'Transações'
              ? 'Transação financeira'
              : 'Objetivo financeiro'
            : row.title,
        detail: source.page === 'finance' ? row.detail : (row.detail?.slice(0, 120) ?? ''),
        group: source.group,
        page: source.page,
      }));
    }),
  );
  const files = await db.select<
    {
      id: string;
      entity_type: string;
      entity_id: string;
      original_name: string;
      finance_date: string | null;
    }[]
  >(
    `SELECT a.id,a.entity_type,a.entity_id,a.original_name,f.date finance_date
     FROM attachments a LEFT JOIN finance_transactions f ON f.id=a.entity_id AND a.entity_type='finance_transaction'
     WHERE instr(lower(a.original_name),lower($1))>0
       AND a.entity_type<>'body_progress_photo'
       AND (a.entity_type<>'finance_transaction' OR $2=0)
       AND (a.entity_type<>'moment' OR $3=0)
     ORDER BY a.created_at DESC LIMIT 10`,
    [term, privacy[0]?.hide_values ? 1 : 0, privateRows[0]?.value === '1' ? 1 : 0],
  );
  const attachments: SearchResult[] = files.map((file) => {
    const page: SearchPage =
      file.entity_type === 'project'
        ? 'projects'
        : file.entity_type === 'thought'
          ? 'thoughts'
          : file.entity_type === 'objective'
            ? 'objectives'
            : file.entity_type === 'moment'
              ? 'timeline'
              : 'finance';
    const sensitive =
      (Boolean(privacy[0]?.hide_values) && page === 'finance') ||
      (privateRows[0]?.value === '1' && page === 'timeline');
    return {
      id: file.id,
      contextId: file.entity_id,
      title: sensitive ? 'Anexo privado' : file.original_name,
      detail: page === 'finance' ? (file.finance_date ?? '') : 'Arquivo local',
      group: page === 'finance' ? 'Transações' : 'Anexos',
      page,
    };
  });
  return [...batches.flat(), ...attachments].slice(0, 40);
}
