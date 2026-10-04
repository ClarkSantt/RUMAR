import type { SqlConnection } from '../../lib/database/connection';
import { localDate, validDate } from '../../lib/dates';
import {
  routineEligible,
  validateRoutine,
  type Routine,
  type RoutineInput,
  type RoutineItem,
  type RoutineOccurrence,
  type RoutineCompletion,
} from './domain';
type Row = Omit<Routine, 'weekdays'> & { weekdays: string };
export class RoutinesRepository {
  constructor(private db: SqlConnection) {}
  async list(): Promise<Routine[]> {
    return (
      await this.db.select<Row[]>(
        'SELECT * FROM routines WHERE archived_at IS NULL ORDER BY sort_order,created_at',
      )
    ).map((r) => ({ ...r, weekdays: JSON.parse(r.weekdays) }));
  }
  items(id: string) {
    return this.db.select<RoutineItem[]>(
      'SELECT * FROM routine_items WHERE routine_id=$1 ORDER BY sort_order,created_at',
      [id],
    );
  }
  occurrences(from: string, to: string, routineId?: string) {
    return this.db.select<RoutineOccurrence[]>(
      `SELECT * FROM routine_occurrences WHERE occurrence_date BETWEEN $1 AND $2 ${routineId ? 'AND routine_id=$3' : ''}`,
      routineId ? [from, to, routineId] : [from, to],
    );
  }
  completions(id: string) {
    return this.db.select<RoutineCompletion[]>(
      'SELECT * FROM routine_item_completions WHERE occurrence_id=$1',
      [id],
    );
  }
  async save(input: RoutineInput, id?: string) {
    const r = validateRoutine(input),
      key = id ?? crypto.randomUUID(),
      now = new Date().toISOString(),
      values = [
        r.name,
        r.description,
        r.frequency,
        JSON.stringify(r.weekdays),
        r.time_of_day,
        r.active,
        now,
        key,
      ];
    await this.db.execute(
      id
        ? 'UPDATE routines SET name=$1,description=$2,frequency=$3,weekdays=$4,time_of_day=$5,active=$6,updated_at=$7 WHERE id=$8'
        : 'INSERT INTO routines(name,description,frequency,weekdays,time_of_day,active,updated_at,id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7)',
      values,
    );
    return key;
  }
  async addItem(id: string, title: string) {
    const key = crypto.randomUUID(),
      now = new Date().toISOString();
    if (!title.trim()) throw Error('Informe o item.');
    await this.db.execute(
      'INSERT INTO routine_items(id,routine_id,title,sort_order,created_at,updated_at) VALUES($1,$2,$3,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM routine_items WHERE routine_id=$2),$4,$4)',
      [key, id, title.trim(), now],
    );
    return key;
  }
  async updateItem(id: string, title: string) {
    if (!title.trim()) throw Error('Informe o item.');
    await this.db.execute('UPDATE routine_items SET title=$1,updated_at=$2 WHERE id=$3', [
      title.trim(),
      new Date().toISOString(),
      id,
    ]);
  }
  async removeItem(id: string) {
    await this.db.execute('DELETE FROM routine_items WHERE id=$1', [id]);
  }
  async moveItem(id: string, direction: -1 | 1) {
    const rows = await this.db.select<RoutineItem[]>(
      'SELECT * FROM routine_items WHERE routine_id=(SELECT routine_id FROM routine_items WHERE id=$1) ORDER BY sort_order,created_at',
      [id],
    );
    const at = rows.findIndex((r) => r.id === id),
      other = rows[at + direction];
    if (at < 0 || !other) return;
    await this.db.execute(
      'UPDATE routine_items SET sort_order=CASE id WHEN $1 THEN $2 WHEN $3 THEN $4 END,updated_at=$5 WHERE id IN($1,$3)',
      [id, other.sort_order, other.id, rows[at].sort_order, new Date().toISOString()],
    );
  }
  async start(id: string, day = localDate()) {
    const r = (await this.list()).find((r) => r.id === id);
    if (!r || !validDate(day) || day > localDate() || !routineEligible(r, day))
      throw Error('Rotina não disponível nessa data.');
    await this.db.execute(
      'INSERT INTO routine_occurrences(id,routine_id,occurrence_date,started_at) VALUES($1,$2,$3,$4) ON CONFLICT(routine_id,occurrence_date) DO NOTHING',
      [crypto.randomUUID(), id, day, new Date().toISOString()],
    );
    return (
      await this.db.select<RoutineOccurrence[]>(
        'SELECT * FROM routine_occurrences WHERE routine_id=$1 AND occurrence_date=$2',
        [id, day],
      )
    )[0];
  }
  async toggle(occurrenceId: string, itemId: string, checked: boolean) {
    const rows = await this.db.select<RoutineOccurrence[]>(
      'SELECT * FROM routine_occurrences WHERE id=$1',
      [occurrenceId],
    );
    if (!rows[0] || rows[0].completed_at)
      throw Error('Reabra a ocorrência antes de alterar os itens.');
    if (checked)
      await this.db.execute(
        'INSERT INTO routine_item_completions(occurrence_id,item_id,completed_at) VALUES($1,$2,$3) ON CONFLICT(occurrence_id,item_id) DO NOTHING',
        [occurrenceId, itemId, new Date().toISOString()],
      );
    else
      await this.db.execute(
        'DELETE FROM routine_item_completions WHERE occurrence_id=$1 AND item_id=$2',
        [occurrenceId, itemId],
      );
  }
  async complete(id: string) {
    const result = await this.db.execute(
      'UPDATE routine_occurrences SET completed_at=$1 WHERE id=$2 AND EXISTS(SELECT 1 FROM routine_items i WHERE i.routine_id=routine_occurrences.routine_id) AND NOT EXISTS(SELECT 1 FROM routine_items i WHERE i.routine_id=routine_occurrences.routine_id AND NOT EXISTS(SELECT 1 FROM routine_item_completions c WHERE c.occurrence_id=$2 AND c.item_id=i.id))',
      [new Date().toISOString(), id],
    );
    if (!result.rowsAffected) throw Error('Conclua todos os itens antes de finalizar.');
  }
  async reopen(id: string) {
    await this.db.execute('UPDATE routine_occurrences SET completed_at=NULL WHERE id=$1', [id]);
  }
  async archive(id: string) {
    await this.db.execute('UPDATE routines SET archived_at=$1,updated_at=$1 WHERE id=$2', [
      new Date().toISOString(),
      id,
    ]);
  }
}
