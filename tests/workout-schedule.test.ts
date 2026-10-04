import { describe, expect, it } from 'vitest';
import { database } from './database';
import { WorkoutScheduleRepository } from '../src/features/workouts/repositories/schedule';
function setup() {
  const d = database();
  d.sqlite.exec(
    "INSERT INTO workout_plans(id,name,active,created_at,updated_at) VALUES('p','Plano',1,'now','now'); INSERT INTO workout_days(id,workout_plan_id,name,weekday,created_at,updated_at) VALUES('d','p','Upper',1,'now','now'); INSERT INTO workout_day_exercises(id,workout_day_id,exercise_id,target_sets,min_reps,max_reps,created_at,updated_at) VALUES('de','d','builtin-bench',3,6,10,'now','now')",
  );
  return { ...d, r: new WorkoutScheduleRepository(d.connection) };
}
function session(
  d: ReturnType<typeof setup>,
  id: string,
  status = 'completed',
  day = '2026-09-21',
) {
  d.sqlite
    .prepare(
      'INSERT INTO workout_sessions(id,workout_plan_id,workout_day_id,plan_name,day_name,session_date,started_at,finished_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      'p',
      'd',
      'Plano da época',
      'Upper da época',
      day,
      `${day}T10:00:00Z`,
      status === 'in_progress' ? null : `${day}T11:00:00Z`,
      status,
      day,
      day,
    );
}
describe('agenda de treinos para Início e Calendário', () => {
  it('consulta hoje e intervalo mensal a partir do plano ativo', async () => {
    const d = setup();
    try {
      expect(await d.r.range('2026-09-21', '2026-09-21')).toMatchObject([
        { day_id: 'd', exercise_count: 1, completed: false },
      ]);
      expect(await d.r.range('2026-09-22', '2026-09-22')).toEqual([]);
      expect(await d.r.range('2026-09-01', '2026-09-30')).toHaveLength(4);
    } finally {
      d.sqlite.close();
    }
  });
  it('concluir substitui planejamento, preservando sessões extras sem duplicar evento', async () => {
    const d = setup();
    try {
      session(d, 's1');
      expect(await d.r.range('2026-09-21', '2026-09-21')).toMatchObject([
        { session_id: 's1', name: 'Upper da época', completed: true },
      ]);
      session(d, 's2');
      expect(await d.r.range('2026-09-21', '2026-09-21')).toHaveLength(2);
    } finally {
      d.sqlite.close();
    }
  });
  it('sessão em andamento e descartada possuem estados corretos', async () => {
    const d = setup();
    try {
      session(d, 's', 'in_progress');
      expect(await d.r.range('2026-09-21', '2026-09-21')).toMatchObject([
        { in_progress: true, completed: false },
      ]);
      d.sqlite.exec(
        "UPDATE workout_sessions SET status='discarded',finished_at='2026-09-21T11:00:00Z' WHERE id='s'",
      );
      expect(await d.r.range('2026-09-21', '2026-09-21')).toMatchObject([
        { session_id: null, in_progress: false },
      ]);
    } finally {
      d.sqlite.close();
    }
  });
  it('editar agenda e trocar plano atualiza sem alterar sessão passada', async () => {
    const d = setup();
    try {
      session(d, 'past');
      d.sqlite.exec("UPDATE workout_days SET weekday=2,name='Novo Upper' WHERE id='d'");
      expect(await d.r.range('2026-09-22', '2026-09-22')).toMatchObject([{ name: 'Novo Upper' }]);
      expect(await d.r.range('2026-09-21', '2026-09-21')).toMatchObject([
        { name: 'Upper da época', completed: true },
      ]);
      d.sqlite.exec("UPDATE workout_plans SET active=0,archived_at='now' WHERE id='p'");
      expect(await d.r.range('2026-09-22', '2026-09-22')).toEqual([]);
      expect(await d.r.range('2026-09-21', '2026-09-21')).toHaveLength(1);
    } finally {
      d.sqlite.close();
    }
  });
  it('dia sem weekday não é agendado automaticamente', async () => {
    const d = setup();
    try {
      d.sqlite.exec("UPDATE workout_days SET weekday=NULL WHERE id='d'");
      expect(await d.r.range('2026-09-01', '2026-09-30')).toEqual([]);
      expect(await d.r.days()).toHaveLength(1);
    } finally {
      d.sqlite.close();
    }
  });
});
