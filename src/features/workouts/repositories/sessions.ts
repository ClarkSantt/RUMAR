import type { SqlConnection } from '../../../lib/database/connection';
import { localDate } from '../../../lib/dates';
import type {
  WorkoutSession,
  SessionDetail,
  SessionExercise,
  WorkoutSet,
  SetInput,
} from '../types';
import { loadTypes } from './catalog';
export class SessionsRepository {
  constructor(private db: SqlConnection) {}
  async current() {
    return (
      (
        await this.db.select<WorkoutSession[]>(
          "SELECT * FROM workout_sessions WHERE status='in_progress' LIMIT 1",
        )
      )[0] ?? null
    );
  }
  list(limit = 50, offset = 0) {
    return this.db.select<WorkoutSession[]>(
      "SELECT * FROM workout_sessions WHERE status<>'in_progress' ORDER BY started_at DESC,id LIMIT $1 OFFSET $2",
      [Math.max(1, Math.min(200, Math.floor(limit))), Math.max(0, Math.floor(offset))],
    );
  }
  async get(id: string): Promise<SessionDetail> {
    const [sessions, exercises, sets] = await Promise.all([
      this.db.select<WorkoutSession[]>('SELECT * FROM workout_sessions WHERE id=$1', [id]),
      this.db.select<SessionExercise[]>(
        'SELECT * FROM workout_session_exercises WHERE workout_session_id=$1 ORDER BY sort_order,id',
        [id],
      ),
      this.db.select<WorkoutSet[]>(
        'SELECT * FROM workout_sets WHERE workout_session_id=$1 ORDER BY set_number,id',
        [id],
      ),
    ]);
    if (!sessions[0]) throw Error('Sessão não encontrada.');
    return { session: sessions[0], exercises, sets };
  }
  async start(dayId: string) {
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    try {
      const result = await this.db.execute(
        `INSERT INTO workout_sessions(id,workout_plan_id,workout_day_id,plan_name,day_name,session_date,started_at,habit_id,created_at,updated_at) SELECT $1,p.id,d.id,p.name,d.name,$3,$4,p.habit_id,$4,$4 FROM workout_days d JOIN workout_plans p ON p.id=d.workout_plan_id WHERE d.id=$2 AND p.archived_at IS NULL AND EXISTS(SELECT 1 FROM workout_day_exercises x JOIN exercises e ON e.id=x.exercise_id WHERE x.workout_day_id=d.id AND e.archived_at IS NULL)`,
        [id, dayId, localDate(), now],
      );
      if (!result.rowsAffected)
        throw Error('Adicione exercícios disponíveis ao dia antes de iniciar.');
      return id;
    } catch (error) {
      if (await this.current())
        throw Error(
          'Já existe um treino em andamento. Continue ou descarte antes de iniciar outro.',
          { cause: error },
        );
      throw error;
    }
  }
  async saveSet(id: string, input: SetInput) {
    if (
      !loadTypes.includes(input.load_type) ||
      !['normal', 'warmup', 'drop'].includes(input.set_type) ||
      ![0, 1].includes(input.completed) ||
      (input.load_value !== null &&
        (!Number.isFinite(input.load_value) ||
          input.load_value < 0 ||
          input.load_value > 100000)) ||
      (input.reps !== null &&
        (!Number.isInteger(input.reps) || input.reps < 0 || input.reps > 1000))
    )
      throw Error('Informe carga e repetições válidas.');
    if (
      input.completed &&
      (input.reps === null ||
        (input.load_value === null && !['none', 'bodyweight'].includes(input.load_type)))
    )
      throw Error('Preencha a carga e as repetições antes de marcar a série.');
    if (input.load_type === 'none' && input.load_value !== null && input.load_value !== 0)
      throw Error('Sem carga não aceita peso adicional.');
    const result = await this.db.execute(
      "UPDATE workout_sets SET set_type=$2,load_value=$3,load_type=$4,reps=$5,completed=$6,notes=$7,updated_at=$8 WHERE id=$1 AND EXISTS(SELECT 1 FROM workout_sessions s WHERE s.id=workout_sets.workout_session_id AND s.status<>'discarded')",
      [
        id,
        input.set_type,
        input.load_value,
        input.load_type,
        input.reps,
        input.completed,
        input.notes,
        new Date().toISOString(),
      ],
    );
    if (!result.rowsAffected) throw Error('Série não disponível para edição.');
  }
  async addSet(sessionExerciseId: string) {
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    const result = await this.db.execute(
      `INSERT INTO workout_sets(id,workout_session_id,session_exercise_id,exercise_id,set_number,load_type,created_at,updated_at) SELECT $1,e.workout_session_id,e.id,e.exercise_id,(SELECT COALESCE(MAX(set_number),0)+1 FROM workout_sets WHERE session_exercise_id=e.id),e.load_type,$3,$3 FROM workout_session_exercises e JOIN workout_sessions s ON s.id=e.workout_session_id WHERE e.id=$2 AND s.status<>'discarded'`,
      [id, sessionExerciseId, now],
    );
    if (!result.rowsAffected) throw Error('Exercício não disponível nesta sessão.');
    return id;
  }
  async removeSet(id: string) {
    await this.db.execute(
      "DELETE FROM workout_sets WHERE id=$1 AND EXISTS(SELECT 1 FROM workout_sessions s WHERE s.id=workout_sets.workout_session_id AND s.status<>'discarded')",
      [id],
    );
  }
  async notes(id: string, notes: string) {
    await this.db.execute('UPDATE workout_sessions SET notes=$2,updated_at=$3 WHERE id=$1', [
      id,
      notes,
      new Date().toISOString(),
    ]);
  }
  async finish(id: string) {
    await this.db.execute(
      "UPDATE workout_sessions SET status='completed',finished_at=$2,updated_at=$2 WHERE id=$1 AND status='in_progress'",
      [id, new Date().toISOString()],
    );
  }
  async discard(id: string) {
    await this.db.execute(
      "UPDATE workout_sessions SET status='discarded',finished_at=$2,updated_at=$2 WHERE id=$1 AND status='in_progress'",
      [id, new Date().toISOString()],
    );
  }
  async remove(id: string) {
    await this.db.execute('DELETE FROM workout_sessions WHERE id=$1', [id]);
  }
  async copyPrevious(sessionExerciseId: string) {
    // One update keeps all placeholders consistent; completed sets remain untouched.
    await this.db.execute(
      `WITH current AS (SELECT e.*,s.started_at FROM workout_session_exercises e JOIN workout_sessions s ON s.id=e.workout_session_id WHERE e.id=$1 AND s.status='in_progress'), previous AS (
   SELECT e.id FROM workout_session_exercises e JOIN workout_sessions s ON s.id=e.workout_session_id JOIN current c ON c.exercise_id=e.exercise_id AND c.load_type=e.load_type
   WHERE s.status='completed' AND s.id<>c.workout_session_id AND s.started_at<=c.started_at AND EXISTS(SELECT 1 FROM workout_sets x WHERE x.session_exercise_id=e.id AND x.completed=1 AND x.load_type=c.load_type)
   ORDER BY s.started_at DESC,s.id DESC,CASE WHEN e.sort_order=c.sort_order THEN 0 ELSE 1 END,e.sort_order LIMIT 1
  ), source AS (SELECT x.* FROM workout_sets x JOIN previous p ON p.id=x.session_exercise_id JOIN current c ON c.load_type=x.load_type WHERE x.completed=1)
  UPDATE workout_sets SET load_value=(SELECT load_value FROM source WHERE source.set_number=workout_sets.set_number),reps=(SELECT reps FROM source WHERE source.set_number=workout_sets.set_number),set_type=(SELECT set_type FROM source WHERE source.set_number=workout_sets.set_number),updated_at=$2
  WHERE session_exercise_id=$1 AND completed=0 AND EXISTS(SELECT 1 FROM source WHERE source.set_number=workout_sets.set_number)`,
      [sessionExerciseId, new Date().toISOString()],
    );
  }
}
