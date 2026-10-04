import type { SqlConnection } from '../../lib/database/connection';
import { localDate, validDate } from '../../lib/dates';
import {
  habitEligible,
  validateHabit,
  type Habit,
  type HabitInput,
  type HabitEntry,
} from './domain';
type Row = Omit<Habit, 'weekdays'> & { weekdays: string };
export class HabitsRepository {
  constructor(private db: SqlConnection) {}
  projectOptions() {
    return this.db.select<{ id: string; name: string }[]>(
      'SELECT id,name FROM projects WHERE archived_at IS NULL ORDER BY name',
    );
  }
  async list(projectId?: string): Promise<Habit[]> {
    const rows = await this.db.select<Row[]>(
      `SELECT * FROM habits WHERE archived_at IS NULL ${projectId ? 'AND project_id=$1' : ''} ORDER BY sort_order,created_at`,
      projectId ? [projectId] : [],
    );
    return rows.map((r) => ({ ...r, weekdays: JSON.parse(r.weekdays) }));
  }
  entries(from: string, to: string, habitId?: string) {
    return this.db.select<HabitEntry[]>(
      `SELECT * FROM habit_entries WHERE entry_date BETWEEN $1 AND $2 ${habitId ? 'AND habit_id=$3' : ''} ORDER BY entry_date`,
      habitId ? [from, to, habitId] : [from, to],
    );
  }
  async save(input: HabitInput, id?: string) {
    const h = validateHabit(input),
      now = new Date().toISOString(),
      key = id ?? crypto.randomUUID();
    const values = [
      h.name,
      h.description,
      h.frequency,
      JSON.stringify(h.weekdays),
      h.weekly_target,
      h.kind,
      h.target_value,
      h.unit,
      h.start_date,
      h.end_date,
      h.project_id,
      h.active,
      now,
      key,
    ];
    if (id)
      await this.db.execute(
        'UPDATE habits SET name=$1,description=$2,frequency=$3,weekdays=$4,weekly_target=$5,kind=$6,target_value=$7,unit=$8,start_date=$9,end_date=$10,project_id=$11,active=$12,updated_at=$13 WHERE id=$14',
        values,
      );
    else
      await this.db.execute(
        'INSERT INTO habits(name,description,frequency,weekdays,weekly_target,kind,target_value,unit,start_date,end_date,project_id,active,updated_at,id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$13)',
        values,
      );
    return key;
  }
  async record(id: string, day: string, value: number) {
    const rows = await this.db.select<Row[]>('SELECT * FROM habits WHERE id=$1', [id]);
    const row = rows[0];
    if (!row) throw Error('Hábito não encontrado.');
    const h = { ...row, weekdays: JSON.parse(row.weekdays) };
    if (
      !validDate(day) ||
      day > localDate() ||
      !habitEligible({ ...h, active: 1, archived_at: null }, day)
    )
      throw Error('Data fora do período do hábito.');
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      (h.kind === 'boolean' && value !== 0 && value !== 1)
    )
      throw Error('Valor inválido.');
    await this.db.execute(
      'INSERT INTO habit_entries(habit_id,entry_date,value,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(habit_id,entry_date) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
      [id, day, value, new Date().toISOString()],
    );
  }
  async archive(id: string) {
    await this.db.execute('UPDATE habits SET archived_at=$1,updated_at=$1 WHERE id=$2', [
      new Date().toISOString(),
      id,
    ]);
  }
}
