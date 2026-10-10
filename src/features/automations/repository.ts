import type { SqlConnection } from '../../lib/database/connection';
import { addDays, localDate } from '../../lib/dates';
import { occursOn } from '../tasks/domain';
import type { Task } from '../../types/models';
import {
  actions,
  triggers,
  scheduledOccurrence,
  validateRule,
  type RuleDraft,
  type AutomationRule,
  type TriggerType,
  type ActionType,
} from './domain';
import { dueNow } from '../notifications/domain';
type StoredRule = Omit<
  AutomationRule,
  'trigger_config' | 'conditions' | 'action_config' | 'enabled'
> & { trigger_config: string; conditions: string; action_config: string; enabled: number };
export interface Execution {
  id: string;
  automation_id: string;
  executed_at: string;
  scheduled_for: string;
  status: 'done' | 'ignored' | 'failed';
  reason: string;
}
interface Event {
  id: string;
  trigger_type: TriggerType;
  entity_type: string;
  entity_id: string;
  project_id: string | null;
  created_at: string;
  depth: number;
}
function read(row: StoredRule): AutomationRule {
  const r = {
    ...row,
    enabled: row.enabled === 1,
    trigger_config: JSON.parse(row.trigger_config),
    conditions: JSON.parse(row.conditions),
    action_config: JSON.parse(row.action_config),
  } as AutomationRule;
  validateRule(r);
  return r;
}
export class AutomationsRepository {
  constructor(private db: SqlConnection) {}
  async list() {
    return (
      await this.db.select<StoredRule[]>(
        `SELECT r.*,(SELECT max(executed_at) FROM automation_executions e WHERE e.automation_id=r.id) last_run_at FROM automation_rules r ORDER BY r.name`,
      )
    ).map(read);
  }
  async save(d: RuleDraft, id?: string, now = new Date()) {
    validateRule(d);
    const next = id ?? crypto.randomUUID(),
      at = now.toISOString();
    await this.db.execute(
      `INSERT INTO automation_rules(id,name,enabled,trigger_type,trigger_config,conditions,action_type,action_config,missed_policy,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,trigger_type=excluded.trigger_type,trigger_config=excluded.trigger_config,conditions=excluded.conditions,action_type=excluded.action_type,action_config=excluded.action_config,missed_policy=excluded.missed_policy,updated_at=excluded.updated_at`,
      [
        next,
        d.name.trim(),
        Number(d.enabled),
        d.trigger_type,
        JSON.stringify(d.trigger_config),
        JSON.stringify(d.conditions),
        d.action_type,
        JSON.stringify(d.action_config),
        d.missed_policy,
        at,
      ],
    );
    return next;
  }
  enable(id: string, value: boolean) {
    return this.db.execute('UPDATE automation_rules SET enabled=$2,updated_at=$3 WHERE id=$1', [
      id,
      Number(value),
      new Date().toISOString(),
    ]);
  }
  remove(id: string) {
    return this.db.execute('DELETE FROM automation_rules WHERE id=$1', [id]);
  }
  logs(id: string) {
    return this.db.select<Execution[]>(
      'SELECT id,automation_id,executed_at,scheduled_for,status,reason FROM automation_executions WHERE automation_id=$1 ORDER BY executed_at DESC LIMIT 100',
      [id],
    );
  }
  async importantFailures() {
    return this.db.select<{ name: string }[]>(
      `SELECT r.name FROM automation_rules r WHERE r.enabled=1 AND (SELECT status FROM automation_executions e WHERE e.automation_id=r.id ORDER BY executed_at DESC LIMIT 1)='failed' LIMIT 3`,
    );
  }
  private async execute(r: AutomationRule, key: string, at: string, now: Date, event?: Event) {
    let status: Execution['status'] = 'done',
      reason = '';
    if (event?.depth === 3) {
      status = 'ignored';
      reason = 'Limite de encadeamento atingido.';
    }
    if (
      (r.conditions.project_id && r.conditions.project_id !== event?.project_id) ||
      (r.conditions.entity_id && r.conditions.entity_id !== event?.entity_id)
    ) {
      status = 'ignored';
      reason = 'Condição não atendida.';
    }
    if (r.conditions.status) {
      const table =
        event?.entity_type === 'task'
          ? 'tasks'
          : event?.entity_type === 'objective'
            ? 'objectives'
            : null;
      const current = table
        ? await this.db.select<{ status: string }[]>(`SELECT status FROM ${table} WHERE id=$1`, [
            event?.entity_id,
          ])
        : [];
      const effectiveStatus =
        event?.trigger_type === 'task_completed' ? 'completed' : current[0]?.status;
      if (effectiveStatus !== r.conditions.status) {
        status = 'ignored';
        reason = 'Condição de status não atendida.';
      }
    }
    if (
      r.action_type === 'link' &&
      (!event ||
        ![
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
        ].includes(event.entity_type))
    ) {
      status = 'ignored';
      reason = 'Esta origem não suporta vínculo.';
    }
    const params = [
      crypto.randomUUID(),
      r.id,
      key,
      at,
      now.toISOString(),
      status,
      reason,
      r.action_type,
      JSON.stringify(r.action_config),
      event?.entity_type ?? null,
      event?.entity_id ?? null,
      event?.depth ?? 0,
    ];
    try {
      await this.db.execute(
        `INSERT INTO automation_executions(id,automation_id,occurrence_key,scheduled_for,executed_at,status,reason,action_type,action_config,entity_type,entity_id,depth) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE EXISTS(SELECT 1 FROM automation_rules WHERE id=$2 AND enabled=1) ON CONFLICT(automation_id,occurrence_key) DO NOTHING`,
        params,
      );
    } catch {
      // The failed action and claim rolled back together; retain only a technical log.
      params[5] = 'failed';
      params[6] = 'A ação não pôde ser persistida. Verifique o destino e a configuração.';
      await this.db.execute(
        `INSERT INTO automation_executions(id,automation_id,occurrence_key,scheduled_for,executed_at,status,reason,action_type,action_config,entity_type,entity_id,depth) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE EXISTS(SELECT 1 FROM automation_rules WHERE id=$2 AND enabled=1) ON CONFLICT(automation_id,occurrence_key) DO NOTHING`,
        params,
      );
    }
  }
  async process(now = new Date()) {
    const rules = (await this.list()).filter((r) => r.enabled);
    if (!rules.length) return;
    for (const rule of rules.filter((r) => r.trigger_type === 'schedule')) {
      const due = scheduledOccurrence(
        rule.trigger_config,
        now,
        rule.missed_policy,
        rule.created_at,
      );
      if (due) await this.execute(rule, due.key, due.at, now);
    }
    await this.processDeadlines(rules, now);
    // Source events are durable; a bounded batch and three generations prevent runaway chains.
    for (let generation = 0; generation < 4; generation++) {
      const pairs = await this.db.select<(Event & { rule_id: string })[]>(
        `SELECT e.*,r.id rule_id FROM automation_events e JOIN automation_rules r ON r.trigger_type=e.trigger_type AND r.enabled=1 AND e.created_at>=r.created_at WHERE e.created_at<=$1 AND NOT EXISTS(SELECT 1 FROM automation_executions x WHERE x.automation_id=r.id AND x.occurrence_key='event:'||e.id) ORDER BY e.created_at,e.id LIMIT 1000`,
        [now.toISOString()],
      );
      if (!pairs.length) break;
      for (const event of pairs) {
        const rule = rules.find((r) => r.id === event.rule_id);
        if (rule) await this.execute(rule, `event:${event.id}`, event.created_at, now, event);
      }
    }
  }
  private async processDeadlines(rules: AutomationRule[], now: Date) {
    const relevant = rules.filter((r) =>
      ['task_due', 'task_overdue', 'objective_due', 'finance_due'].includes(r.trigger_type),
    );
    if (!relevant.length) return;
    const day = localDate(now);
    for (const r of relevant) {
      const time = r.trigger_config.time ?? '09:00';
      if (r.missed_policy === 'ignore' && !dueNow(day, time, now)) continue;
      const days = r.trigger_config.days ?? 1,
        date = addDays(
          new Date(`${day}T${time}:00`) > now ? addDays(day, -1) : day,
          r.trigger_type === 'task_overdue' ? -days : days,
        );
      const firstDate = addDays(date, r.missed_policy === 'latest' ? -31 : 0);
      let entities: { id: string; project_id: string | null; date: string }[] = [];
      if (r.trigger_type.startsWith('task_')) {
        entities = await this.db.select(
          `SELECT id,project_id,due_date date FROM tasks WHERE due_date BETWEEN $1 AND $2 AND status='pending' AND archived_at IS NULL AND recurrence IS NULL LIMIT 1000`,
          [firstDate, date],
        );
        const recurring = await this.db.select<
          (Omit<Task, 'recurrence'> & { recurrence: string })[]
        >(
          `SELECT * FROM tasks WHERE recurrence IS NOT NULL AND due_date<=$1 AND status='pending' AND archived_at IS NULL LIMIT 1000`,
          [date],
        );
        const completed = await this.db.select<{ task_id: string; occurrence_date: string }[]>(
          'SELECT task_id,occurrence_date FROM task_completions WHERE occurrence_date BETWEEN $1 AND $2',
          [firstDate, date],
        );
        for (const raw of recurring) {
          const task: Task = { ...raw, recurrence: JSON.parse(raw.recurrence) };
          for (let d = date; d >= firstDate; d = addDays(d, -1))
            if (
              occursOn(task, d) &&
              !completed.some((c) => c.task_id === raw.id && c.occurrence_date === d)
            ) {
              entities.push({ id: raw.id, project_id: raw.project_id ?? null, date: d });
              break;
            }
        }
      }
      if (r.trigger_type === 'objective_due')
        entities = await this.db.select(
          `SELECT id,NULL project_id,target_date date FROM objectives WHERE target_date BETWEEN $1 AND $2 AND lifecycle_status='active' AND deleted_at IS NULL LIMIT 1000`,
          [firstDate, date],
        );
      if (r.trigger_type === 'finance_due') {
        const bills = await this.db.select<{ id: string; day_of_month: number }[]>(
          'SELECT id,day_of_month FROM finance_recurring WHERE active=1 LIMIT 1000',
        );
        for (const bill of bills) {
          for (let d = date; d >= firstDate; d = addDays(d, -1)) {
            const last = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0).getDate();
            if (Number(d.slice(8)) === Math.min(bill.day_of_month, last)) {
              entities.push({ id: bill.id, project_id: null, date: d });
              break;
            }
          }
        }
      }
      for (const entity of entities) {
        const occurrenceDay = addDays(
          entity.date,
          r.trigger_type === 'task_overdue' ? days : -days,
        );
        const scheduled = new Date(`${occurrenceDay}T${time}:00`);
        if (
          scheduled > now ||
          scheduled < new Date(r.created_at) ||
          (r.missed_policy === 'ignore' && !dueNow(occurrenceDay, time, now))
        )
          continue;
        await this.execute(
          r,
          `${r.trigger_type}:${entity.id}:${entity.date}`,
          scheduled.toISOString(),
          now,
          {
            id: entity.id,
            trigger_type: r.trigger_type,
            entity_type: r.trigger_type.startsWith('task_')
              ? 'task'
              : r.trigger_type === 'objective_due'
                ? 'objective'
                : 'finance',
            entity_id: entity.id,
            project_id: entity.project_id,
            created_at: now.toISOString(),
            depth: 0,
          },
        );
      }
    }
  }
}
export { actions, triggers };
export type { ActionType };
