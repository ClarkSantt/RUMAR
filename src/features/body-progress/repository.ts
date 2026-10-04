import type { SqlConnection } from '../../lib/database/connection';
import {
  metrics,
  parseMeasurement,
  type BodyRecord,
  type Measurements,
  type MetricKey,
} from './domain';

type RecordRow = {
  measurement_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
  metric_key: MetricKey | null;
  value: number | null;
};
function validDay(day: string) {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day
  )
    throw Error('Informe uma data válida.');
}
export class BodyProgressRepository {
  constructor(private readonly db: SqlConnection) {}

  async records(limit = 100): Promise<BodyRecord[]> {
    const rows = await this.db.select<RecordRow[]>(
      `SELECT r.measurement_date,r.notes,r.created_at,r.updated_at,v.metric_key,v.value
       FROM (SELECT * FROM body_measurement_records ORDER BY measurement_date DESC LIMIT $1) r
       LEFT JOIN body_measurement_values v ON v.record_date=r.measurement_date
       ORDER BY r.measurement_date DESC`,
      [Math.max(1, Math.min(1000, limit))],
    );
    const byDay = new Map<string, BodyRecord>();
    for (const row of rows) {
      let record = byDay.get(row.measurement_date);
      if (!record) {
        record = {
          date: row.measurement_date,
          notes: row.notes,
          values: {},
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
        byDay.set(row.measurement_date, record);
      }
      if (row.metric_key && row.value != null) record.values[row.metric_key] = row.value;
    }
    return [...byDay.values()];
  }

  history(key: MetricKey, limit = 100) {
    return this.db.select<{ date: string; value: number }[]>(
      `SELECT record_date AS date,value FROM body_measurement_values
       WHERE metric_key=$1 ORDER BY record_date DESC LIMIT $2`,
      [key, Math.max(1, Math.min(1000, limit))],
    );
  }

  async save(
    day: string,
    changes: Partial<Record<MetricKey, string | number | null>>,
    notes?: string,
  ) {
    validDay(day);
    const payload: Partial<Record<MetricKey, number | null>> = {};
    for (const [key, value] of Object.entries(changes) as [MetricKey, string | number | null][]) {
      if (!metrics.some(([id]) => id === key)) throw Error('Medida desconhecida.');
      payload[key] = value === null || value === '' ? null : parseMeasurement(value, key);
    }
    if (!Object.keys(payload).length && notes === undefined)
      throw Error('Informe uma medida ou observação.');
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO body_measurement_records(record_id,measurement_date,notes,pending_values,created_at,updated_at)
       VALUES($1,$1,COALESCE($2,''),$3,$4,$4)
       ON CONFLICT(measurement_date) DO UPDATE SET
       notes=COALESCE($2,body_measurement_records.notes),
       pending_values=excluded.pending_values,updated_at=excluded.updated_at`,
      [day, notes?.trim() ?? null, JSON.stringify(payload), now],
    );
    return day;
  }

  remove(day: string) {
    return this.db.execute('DELETE FROM body_measurement_records WHERE measurement_date=$1', [day]);
  }

  async weights(limit = 100) {
    const rows = await this.db.select<
      {
        id: string;
        entry_date: string;
        weight_kg: number;
        notes: string;
        created_at: string;
        updated_at: string;
      }[]
    >(
      `SELECT r.record_id AS id,r.measurement_date AS entry_date,
       v.value AS weight_kg,r.notes,r.created_at,r.updated_at
       FROM body_measurement_values v JOIN body_measurement_records r
       ON r.measurement_date=v.record_date WHERE v.metric_key='weight'
       ORDER BY r.measurement_date DESC LIMIT $1`,
      [Math.max(1, Math.min(1000, limit))],
    );
    return rows;
  }

  async saveWeight(day: string, weight: string | number, notes = '', recordId?: string) {
    if (recordId) {
      validDay(day);
      const kg = parseMeasurement(weight, 'weight');
      const result = await this.db.execute(
        `UPDATE body_measurement_records SET measurement_date=$1,notes=$2,
         pending_values=$3,updated_at=$4 WHERE record_id=$5`,
        [day, notes.trim(), JSON.stringify({ weight: kg }), new Date().toISOString(), recordId],
      );
      if (!result.rowsAffected) throw Error('Registro de peso não encontrado.');
      return recordId;
    }
    return this.save(day, { weight }, notes);
  }

  async removeWeight(recordId: string) {
    const rows = await this.db.select<{ measurement_date: string }[]>(
      'SELECT measurement_date FROM body_measurement_records WHERE record_id=$1',
      [recordId],
    );
    const day = rows[0]?.measurement_date;
    if (!day) return { rowsAffected: 0 };
    await this.save(day, { weight: null });
    return this.db.execute(
      `DELETE FROM body_measurement_records WHERE measurement_date=$1 AND notes=''
       AND NOT EXISTS(SELECT 1 FROM body_measurement_values WHERE record_date=$1)`,
      [day],
    );
  }

  latestValues(records: BodyRecord[]): Measurements {
    const result: Measurements = {};
    for (const record of records)
      for (const [key, value] of Object.entries(record.values) as [MetricKey, number][])
        if (result[key] === undefined) result[key] = value;
    return result;
  }
}
