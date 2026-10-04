import { describe, it, expect } from 'vitest';
import { database } from './database';
import {
  parseLoad,
  recordedVolume,
  exerciseMetrics,
  newRecords,
  type MetricSet,
} from '../src/features/workouts/domain';
import { WorkoutHistoryRepository } from '../src/features/workouts/repositories/history';
const set = (load: number, reps: number, overrides: Partial<MetricSet> = {}): MetricSet => ({
  exercise_id: 'bench',
  workout_session_id: `s${load}-${reps}`,
  load_type: 'per_side',
  load_value: load,
  reps,
  completed: 1,
  set_type: 'normal',
  session_status: 'completed',
  session_date: '2026-09-26',
  ...overrides,
});
describe('carga e métricas de treino', () => {
  it('normaliza números pt-BR e ponto sem aceitar valor inválido', () => {
    for (const [value, expected] of [
      ['30', 30],
      ['27.5', 27.5],
      ['2.5', 2.5],
      ['0', 0],
      ['27,5', 27.5],
    ] as const)
      expect(parseLoad(value)).toBe(expected);
    for (const value of ['', ' ', '-1', 'Infinity', 'NaN', '1,2,3', '1e3'])
      expect(() => parseLoad(value)).toThrow();
  });
  it('volume usa valor registrado sem dobrar lado ou halter', () => {
    for (const load_type of ['per_side', 'per_dumbbell', 'total'] as const)
      expect(recordedVolume(set(30, 8, { load_type }))).toBe(240);
    expect(recordedVolume(set(10, 8, { load_type: 'bodyweight' }))).toBeNull();
    expect(recordedVolume(set(0, 8, { load_type: 'none' }))).toBeNull();
  });
  it('separa maior carga, reps por carga e maior volume da sessão', () => {
    const rows = [set(30, 8), set(30, 10), set(32.5, 7)];
    const metrics = exerciseMetrics(rows, 'bench', 'per_side');
    expect(metrics.maxLoad).toBe(32.5);
    expect(metrics.repsByLoad.get(30)).toBe(10);
    expect(metrics.maxSessionVolume).toBe(300);
  });
  it('agrupa volume por sessão sem misturar exercício ou tipo de carga', () => {
    const rows = [
      set(30, 8, { workout_session_id: 'a' }),
      set(25, 10, { workout_session_id: 'a' }),
      set(100, 10, { load_type: 'total' }),
      set(200, 10, { exercise_id: 'other' }),
    ];
    expect(exerciseMetrics(rows, 'bench', 'per_side').maxSessionVolume).toBe(490);
    expect(exerciseMetrics(rows, 'bench', 'total').maxSessionVolume).toBe(1000);
  });
  it('exclui aquecimento e séries/sessões incompletas ou descartadas', () => {
    const rows = [
      set(30, 8),
      set(100, 20, { set_type: 'warmup' }),
      set(100, 20, { completed: 0 }),
      set(100, 20, { session_status: 'in_progress' }),
      set(100, 20, { session_status: 'discarded' }),
    ];
    expect(exerciseMetrics(rows, 'bench', 'per_side')).toMatchObject({
      maxLoad: 30,
      maxSessionVolume: 240,
    });
  });
  it('peso corporal registra carga adicional sem volume e sem carga compara reps', () => {
    const body = exerciseMetrics([set(10, 8, { load_type: 'bodyweight' })], 'bench', 'bodyweight');
    expect(body.maxLoad).toBe(10);
    expect(body.maxSessionVolume).toBeNull();
    expect(
      exerciseMetrics(
        [set(0, 8, { load_type: 'bodyweight', load_value: null })],
        'bench',
        'bodyweight',
      ).maxLoad,
    ).toBe(0);
    const none = exerciseMetrics(
      [set(0, 20, { load_type: 'none', load_value: null })],
      'bench',
      'none',
    );
    expect(none.maxLoad).toBeNull();
    expect(none.repsByLoad.get(0)).toBe(20);
    expect(none.maxSessionVolume).toBeNull();
  });
  it('nova marca compara histórico concluído e mesma interpretação', () => {
    const history = [set(30, 8)];
    expect(newRecords(set(30, 9, { session_status: 'in_progress' }), history)).toEqual(['reps']);
    expect(newRecords(set(32.5, 7), history)).toEqual(['load']);
    expect(newRecords(set(30, 8), history)).toEqual([]);
    expect(newRecords(set(40, 10, { load_type: 'total' }), history)).toEqual([]);
    expect(newRecords(set(40, 10, { set_type: 'warmup' }), history)).toEqual([]);
  });
});
function seed(
  d: ReturnType<typeof database>,
  id: string,
  day: string,
  load: number,
  reps: number,
  status = 'completed',
  loadType = 'per_side',
  setType = 'normal',
) {
  d.sqlite
    .prepare(
      'INSERT INTO workout_sessions(id,plan_name,day_name,session_date,started_at,finished_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      'Plano',
      'Upper',
      day,
      `${day}T10:00:00Z`,
      status === 'in_progress' ? null : `${day}T11:00:00Z`,
      status,
      day,
      day,
    );
  d.sqlite
    .prepare(
      'INSERT INTO workout_session_exercises(id,workout_session_id,exercise_id,exercise_name,load_type,target_sets,min_reps,max_reps,sort_order) VALUES(?,?,?,?,?,1,6,10,0)',
    )
    .run(`${id}:e`, id, 'builtin-bench', 'Supino da época', loadType);
  d.sqlite
    .prepare(
      'INSERT INTO workout_sets(id,workout_session_id,session_exercise_id,exercise_id,set_number,set_type,load_value,load_type,reps,completed,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?,?,1,?,?)',
    )
    .run(`${id}:s`, id, `${id}:e`, 'builtin-bench', setType, load, loadType, reps, day, day);
}
describe('consultas de histórico e marcas', () => {
  it('limita exercício/período/tipo e preserva snapshots arquivados', async () => {
    const d = database();
    try {
      seed(d, 'a', '2026-09-01', 30, 8);
      seed(d, 'b', '2026-09-02', 100, 8, 'completed', 'total');
      seed(d, 'old', '2020-01-01', 40, 8);
      seed(d, 'progress', '2026-09-03', 100, 10, 'in_progress');
      d.sqlite
        .prepare(
          "UPDATE exercises SET archived_at='now',name='Nome alterado' WHERE id='builtin-bench'",
        )
        .run();
      const r = new WorkoutHistoryRepository(d.connection),
        rows = await r.exercise('builtin-bench', {
          from: '2026-09-01',
          to: '2026-09-30',
          loadType: 'per_side',
        });
      expect(rows).toHaveLength(1);
      expect(rows[0].exercise_name).toBe('Supino da época');
      expect(await r.exercise('missing')).toEqual([]);
      expect((await r.exerciseOptions()).find((e) => e.id === 'builtin-bench')?.archived_at).toBe(
        'now',
      );
    } finally {
      d.sqlite.close();
    }
  });
  it('última sessão usa somente finalizada antes da atual e respeita tipo', async () => {
    const d = database();
    try {
      seed(d, 'a', '2026-09-01', 30, 8);
      seed(d, 'b', '2026-09-02', 100, 8, 'completed', 'total');
      seed(d, 'c', '2026-09-03', 100, 10, 'discarded');
      const r = new WorkoutHistoryRepository(d.connection);
      expect(
        (await r.previousSession('builtin-bench', '2026-09-04T10:00:00Z', undefined, 'per_side'))[0]
          .workout_session_id,
      ).toBe('a');
      expect(
        (await r.previousSession('builtin-bench', '2026-09-04T10:00:00Z'))[0].workout_session_id,
      ).toBe('b');
    } finally {
      d.sqlite.close();
    }
  });
  it('marcas lifetime recomputam após editar/excluir e excluem aquecimento/atual', async () => {
    const d = database();
    try {
      seed(d, 'old', '2020-01-01', 30, 8);
      seed(d, 'new', '2026-09-02', 30, 10);
      seed(d, 'load', '2026-09-03', 32.5, 7);
      seed(d, 'warmup', '2026-09-04', 100, 20, 'completed', 'per_side', 'warmup');
      const r = new WorkoutHistoryRepository(d.connection);
      let records = await r.lifetimeRecords('builtin-bench', 'per_side');
      expect(records.maxLoad).toBe(32.5);
      expect(records.repsByLoad.get(30)).toBe(10);
      expect(records.maxSessionVolume).toBe(300);
      expect((await r.lifetimeRecords('builtin-bench', 'per_side', 'load')).maxLoad).toBe(30);
      d.sqlite
        .prepare("UPDATE workout_sets SET load_value=25 WHERE workout_session_id='load'")
        .run();
      d.sqlite.prepare("DELETE FROM workout_sessions WHERE id='new'").run();
      records = await r.lifetimeRecords('builtin-bench', 'per_side');
      expect(records.maxLoad).toBe(30);
      expect(records.repsByLoad.get(30)).toBe(8);
      expect(records.maxSessionVolume).toBe(240);
    } finally {
      d.sqlite.close();
    }
  });
});
