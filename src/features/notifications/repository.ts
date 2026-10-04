import type { SqlConnection } from '../../lib/database/connection';
import { addDays, localDate } from '../../lib/dates';
import { occursOn } from '../tasks/domain';
import type { Task } from '../../types/models';
import { routineEligible, type Routine } from '../routines/domain';
import { WorkoutScheduleRepository } from '../workouts/repositories/schedule';
import { PlannerRepository } from '../calendar/planner-repository';
import {
  defaultNotifications,
  dueNow,
  type NotificationPreferences,
  type Reminder,
  type NotificationCategory,
  validTime,
} from './domain';

type StoredTask = Omit<Task, 'recurrence'> & { recurrence: string | null };
export class NotificationsRepository {
  constructor(private db: SqlConnection) {}
  async preferences(): Promise<NotificationPreferences> {
    const rows = await this.db.select<{ key: string; value: string }[]>(
      'SELECT key,value FROM notification_preferences',
    );
    const found = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const result = { ...defaultNotifications };
    for (const key of Object.keys(result) as (keyof NotificationPreferences)[]) {
      const value = found[key];
      if (value === undefined) continue;
      if (typeof result[key] === 'boolean') Object.assign(result, { [key]: Number(value) === 1 });
      else if (typeof result[key] === 'number') Object.assign(result, { [key]: Number(value) });
      else Object.assign(result, { [key]: value });
    }
    return result;
  }
  async save<K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) {
    if (!(key in defaultNotifications)) throw Error('Preferência desconhecida.');
    if (typeof value === 'string' && key.endsWith('_time') && !validTime(value))
      throw Error('Horário inválido.');
    if (
      key === 'body_weekday' &&
      (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 6)
    )
      throw Error('Dia da semana inválido.');
    await this.db.execute(
      'INSERT INTO notification_preferences(key,value,updated_at) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
      [key, typeof value === 'boolean' ? (value ? '1' : '0') : value, new Date().toISOString()],
    );
  }
  async due(now: Date, prefs: NotificationPreferences): Promise<Reminder[]> {
    if (!prefs.enabled) return [];
    const day = localDate(now),
      tomorrow = addDays(day, 1);
    const pending: Reminder[] = [];
    if (prefs.automations) {
      const queued = await this.db.select<
        {
          execution_id: string;
          title: string;
          created_at: string;
          trigger_type: string;
          hide_values: number;
        }[]
      >(
        `SELECT q.*,r.trigger_type,coalesce(p.hide_values,0) hide_values FROM automation_notification_queue q JOIN automation_executions e ON e.id=q.execution_id JOIN automation_rules r ON r.id=e.automation_id LEFT JOIN finance_preferences p ON p.id=1 WHERE q.created_at>=$1 AND q.created_at<=$2 AND NOT EXISTS(SELECT 1 FROM notification_deliveries d WHERE d.delivery_key='automation:'||q.execution_id) ORDER BY q.created_at,q.execution_id LIMIT 100`,
        [new Date(now.getTime() - 86400000).toISOString(), now.toISOString()],
      );
      for (const q of queued)
        pending.push({
          key: `automation:${q.execution_id}`,
          category: 'automations',
          scheduledFor: q.created_at,
          title:
            q.hide_values && ['finance_due', 'goal_contribution'].includes(q.trigger_type)
              ? 'Lembrete financeiro'
              : q.title,
          body: 'Lembrete configurado no RUMAR.',
        });
    }
    const add = (
      category: NotificationCategory,
      id: string,
      date: string,
      time: string,
      title: string,
      body: string,
      lead = 0,
    ) => {
      if (dueNow(date, time, now, lead))
        pending.push({
          key: `${category}:${id}:${date}:${time}:${lead}`,
          category,
          scheduledFor: `${date}T${time}`,
          title,
          body,
        });
    };
    const jobs: Promise<void>[] = [];
    if (prefs.blocks)
      jobs.push(
        new PlannerRepository(this.db).range(day, tomorrow).then((rows) => {
          for (const row of rows)
            if (row.remind_minutes_before !== null)
              add(
                'blocks',
                row.id,
                row.block_date,
                row.start_time,
                'Bloco programado',
                row.name,
                row.remind_minutes_before,
              );
        }),
      );
    if (prefs.tasks)
      jobs.push(
        this.db
          .select<StoredTask[]>(
            `SELECT * FROM tasks WHERE archived_at IS NULL AND status='pending' AND due_time IS NOT NULL AND remind_minutes_before IS NOT NULL AND (recurrence IS NOT NULL OR due_date BETWEEN $1 AND $2)`,
            [addDays(day, -1), tomorrow],
          )
          .then(async (tasks) => {
            const completed = await this.db.select<{ task_id: string; occurrence_date: string }[]>(
              'SELECT task_id,occurrence_date FROM task_completions WHERE occurrence_date BETWEEN $1 AND $2',
              [day, tomorrow],
            );
            for (const row of tasks) {
              const task: Task = {
                ...row,
                recurrence: row.recurrence
                  ? (JSON.parse(row.recurrence) as Task['recurrence'])
                  : null,
              };
              for (const date of [day, tomorrow]) {
                if (
                  !occursOn(task, date) ||
                  completed.some((c) => c.task_id === task.id && c.occurrence_date === date)
                )
                  continue;
                add(
                  'tasks',
                  task.id,
                  date,
                  task.due_time!,
                  'Tarefa no RUMAR',
                  task.title,
                  task.remind_minutes_before ?? 0,
                );
              }
            }
          }),
      );
    if (prefs.routines)
      jobs.push(
        this.db
          .select<(Omit<Routine, 'weekdays'> & { weekdays: string })[]>(
            `SELECT * FROM routines WHERE active=1 AND archived_at IS NULL AND time_of_day IS NOT NULL`,
          )
          .then(async (rows) => {
            const done = await this.db.select<{ routine_id: string }[]>(
              'SELECT routine_id FROM routine_occurrences WHERE occurrence_date=$1 AND completed_at IS NOT NULL',
              [day],
            );
            for (const row of rows) {
              const routine: Routine = { ...row, weekdays: JSON.parse(row.weekdays) as number[] };
              if (routineEligible(routine, day) && !done.some((d) => d.routine_id === row.id))
                add('routines', row.id, day, row.time_of_day!, 'Rotina programada', row.name);
            }
          }),
      );
    if (prefs.workouts)
      jobs.push(
        new WorkoutScheduleRepository(this.db).range(day, day).then((rows) => {
          for (const row of rows.filter((item) => !item.session_id))
            add('workouts', row.id, day, prefs.workout_time, 'Treino programado', row.name);
        }),
      );
    if (prefs.finance)
      jobs.push(
        this.db
          .select<{ id: string; description: string; day_of_month: number }[]>(
            'SELECT id,description,day_of_month FROM finance_recurring WHERE active=1',
          )
          .then((rows) => {
            const last = new Date(
              Number(tomorrow.slice(0, 4)),
              Number(tomorrow.slice(5, 7)),
              0,
            ).getDate();
            for (const row of rows)
              if (Math.min(row.day_of_month, last) === Number(tomorrow.slice(8)))
                add(
                  'finance',
                  row.id,
                  day,
                  prefs.finance_time,
                  'Conta prevista amanhã',
                  row.description,
                );
          }),
      );
    if (prefs.activity)
      jobs.push(
        this.db
          .select<{ entry_date: string }[]>(
            'SELECT entry_date FROM daily_activity_entries WHERE entry_date=$1',
            [day],
          )
          .then((rows) => {
            if (!rows.length)
              add(
                'activity',
                'steps',
                day,
                prefs.activity_time,
                'Atividade diária',
                'Registrar passos de hoje.',
              );
          }),
      );
    if (prefs.body && now.getDay() === prefs.body_weekday)
      jobs.push(
        this.db
          .select<{ record_date: string }[]>(
            "SELECT record_date FROM body_measurement_values WHERE metric_key='weight' AND record_date=$1",
            [day],
          )
          .then((rows) => {
            if (!rows.length)
              add(
                'body',
                'weight',
                day,
                prefs.body_time,
                'Progresso corporal',
                'Registrar peso ou medidas.',
              );
          }),
      );
    if (prefs.review && now.getDay() === 0)
      add(
        'review',
        'weekly',
        day,
        prefs.review_time,
        'Revisão Semanal',
        'Veja o que foi registrado nesta semana.',
      );
    await Promise.all(jobs);
    return pending;
  }
  async claim(reminder: Reminder): Promise<boolean> {
    const result = await this.db.execute(
      'INSERT OR IGNORE INTO notification_deliveries(delivery_key,category,scheduled_for,delivered_at) VALUES($1,$2,$3,$4)',
      [reminder.key, reminder.category, reminder.scheduledFor, new Date().toISOString()],
    );
    return result.rowsAffected > 0;
  }
}
