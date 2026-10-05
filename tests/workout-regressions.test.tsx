// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SqlConnection } from '../src/lib/database/connection';
import { getDatabase } from '../src/lib/database/connection';
import { PlansRepository } from '../src/features/workouts/repositories/plans';
import { SessionsRepository } from '../src/features/workouts/repositories/sessions';
import { ExercisesRepository } from '../src/features/workouts/repositories/catalog';
import { WorkoutHistoryRepository } from '../src/features/workouts/repositories/history';
import { WorkoutScheduleRepository } from '../src/features/workouts/repositories/schedule';
import { SessionEditor } from '../src/features/workouts/components/SessionEditor';
import { Evolution } from '../src/features/workouts/components/Evolution';
import { PlanEditor } from '../src/features/workouts/components/PlanEditor';
import { ExerciseLibrary } from '../src/features/workouts/components/ExerciseLibrary';
import { flushWorkouts } from '../src/features/workouts/persistence';
import { exerciseMetrics } from '../src/features/workouts/domain';
import { Workouts } from '../src/features/workouts/Workouts';
import { addDays, localDate, parseDate } from '../src/lib/dates';

vi.mock('../src/lib/database/connection', () => ({ getDatabase: vi.fn() }));

// jsdom rewrites import.meta.url to an HTTP origin; resolve real migrations from the repo.
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of [
    '0001_foundation.sql',
    '0002_organization.sql',
    '0003_workouts.sql',
    '0004_nutrition.sql',
    '0005_nutrition_units.sql',
    '0006_finance.sql',
    '0007_finance_integrity.sql',
    '0008_release.sql',
    '0009_body_progress.sql',
    '0010_planning_energy.sql',
    '0011_activity_overlap.sql',
    '0012_exercise_library.sql',
  ]) {
    sqlite.exec(readFileSync(resolve('src-tauri/migrations', name), 'utf8'));
  }
  const bind = (values: unknown[]) =>
    Object.fromEntries(values.map((value, i) => [`$${i + 1}`, value as string | number | null]));
  const connection: SqlConnection = {
    async select<T>(sql: string, values: unknown[] = []) {
      return sqlite.prepare(sql).all(bind(values)) as T;
    },
    async execute(sql, values = []) {
      return { rowsAffected: Number(sqlite.prepare(sql).run(bind(values)).changes) };
    },
  };
  return { sqlite, connection };
}

describe('Regressões integradas de treinos com SQLite e interface reais', () => {
  let db: ReturnType<typeof database>;
  beforeEach(() => {
    db = database();
    vi.mocked(getDatabase).mockResolvedValue(db.connection);
  });
  afterEach(async () => {
    await act(async () => {
      await flushWorkouts();
    });
    cleanup();
    await Promise.resolve();
    db?.sqlite.close();
  });
  async function planWith(exerciseIds: string[]) {
    const plans = new PlansRepository(db.connection);
    const plan = await plans.save({ name: 'Plano regressão', description: '', habit_id: null });
    await plans.activate(plan);
    const day = await plans.saveDay(plan, {
      name: 'Upper',
      weekday: parseDate(localDate()).getDay(),
      notes: '',
    });
    for (const exercise_id of exerciseIds)
      await plans.saveExercise(day, {
        exercise_id,
        target_sets: 1,
        min_reps: 6,
        max_reps: 12,
        rest_seconds: null,
        notes: '',
      });
    return day;
  }
  it('mostra treino, plano e contexto semanal antes de iniciar', async () => {
    await planWith(['builtin-bench']);
    render(<Workouts day={localDate()} />);
    expect(await screen.findByRole('button', { name: 'Iniciar treino' })).toBeTruthy();
    expect(screen.getByText('Supino reto')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Contexto desta semana' })).toBeTruthy();
  });
  it('oferece continuidade para uma sessão em andamento', async () => {
    const day = await planWith(['builtin-bench']);
    await new SessionsRepository(db.connection).start(day);
    render(<Workouts day={localDate()} />);
    expect(await screen.findByRole('button', { name: 'Continuar treino' })).toBeTruthy();
    expect(screen.getByText('Supino reto')).toBeTruthy();
  });
  it('permite consultar plano arquivado sem editar dias ou exercícios', async () => {
    const user = userEvent.setup(),
      plans = new PlansRepository(db.connection);
    await planWith(['builtin-bench']);
    const id = (await plans.list())[0].id;
    await plans.archive(id);
    render(<PlanEditor />);
    expect(await screen.findByText('Nenhum plano de treino ainda.')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Mostrar planos arquivados' }));
    expect(await screen.findByText('Plano arquivado · somente leitura')).toBeTruthy();
    expect(await screen.findByText('Supino reto')).toBeTruthy();
    for (const name of [
      'Ativar plano',
      'Editar plano',
      'Adicionar dia',
      'Editar dia Upper',
      'Remover dia Upper',
      'Adicionar exercício',
      'Editar exercício Supino reto',
      'Duplicar exercício Supino reto',
      'Remover exercício Supino reto',
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button.matches(':disabled'), name).toBe(true);
    }
    await user.click(screen.getByRole('checkbox', { name: 'Mostrar planos arquivados' }));
    expect(await screen.findByText('Nenhum plano de treino ainda.')).toBeTruthy();
    expect(await plans.list(true)).toHaveLength(1);
  });
  it('abre histórico do exercício identificado sem alterar sua biblioteca', async () => {
    const user = userEvent.setup(),
      onHistory = vi.fn();
    render(<ExerciseLibrary onHistory={onHistory} />);
    await user.type(screen.getByRole('searchbox', { name: 'Buscar exercício' }), 'Supino reto');
    await user.click(await screen.findByRole('button', { name: 'Histórico de Supino reto' }));
    expect(onHistory).toHaveBeenCalledWith('builtin-bench');
    expect(
      (await new ExercisesRepository(db.connection).list()).find((e) => e.id === 'builtin-bench')
        ?.archived_at,
    ).toBeNull();
  });
  it('editar histórico de 30×8 para 30×10 atualiza resumo, histórico, PR e evolução sem reiniciar', async () => {
    const user = userEvent.setup(),
      sessions = new SessionsRepository(db.connection),
      history = new WorkoutHistoryRepository(db.connection);
    const day = await planWith(['builtin-bench']);
    const id = await sessions.start(day),
      set = (await sessions.get(id)).sets[0];
    await sessions.saveSet(set.id, {
      load_value: 30,
      reps: 8,
      completed: 1,
      load_type: 'per_side',
      set_type: 'normal',
      notes: '',
    });
    await sessions.finish(id);
    function Navigation() {
      const [view, setView] = useState<'session' | 'evolution'>('session');
      return view === 'session' ? (
        <SessionEditor id={id} onBack={() => setView('evolution')} />
      ) : (
        <Evolution exerciseId="builtin-bench" />
      );
    }
    render(<Navigation />);
    expect(await screen.findByText('1 séries · 8 repetições')).toBeTruthy();
    expect(screen.getByText(/Volume registrado.*240 × rep/)).toBeTruthy();
    const reps = screen.getByRole('textbox', { name: 'Série 1: repetições' });
    await user.clear(reps);
    await user.type(reps, '10');
    await user.tab();
    expect(await screen.findByText('1 séries · 10 repetições')).toBeTruthy();
    expect(await screen.findByText(/Volume registrado.*300 × rep/)).toBeTruthy();
    expect(screen.queryByText(/Volume registrado.*240 × rep/)).toBeNull();
    expect((await sessions.get(id)).sets[0]).toMatchObject({
      load_value: 30,
      reps: 10,
      completed: 1,
    });
    expect((await sessions.list())[0]).toMatchObject({ id, status: 'completed' });
    const records = await history.lifetimeRecords('builtin-bench', 'per_side');
    expect(records.maxLoad).toBe(30);
    expect(records.repsByLoad.get(30)).toBe(10);
    expect(records.maxSessionVolume).toBe(300);
    const rows = await history.exercise('builtin-bench');
    expect(rows).toHaveLength(1);
    expect(rows[0].reps).toBe(10);
    expect(exerciseMetrics(rows, 'builtin-bench', 'per_side').sessions[0].volume).toBe(300);
    await user.click(screen.getByRole('button', { name: '← Voltar aos treinos' }));
    expect(await screen.findByText('300 kg/lado × reps')).toBeTruthy();
    expect(screen.getByText('30 kg/lado × 10')).toBeTruthy();
  });
  it('arquivar exercício reduz agenda de 3 para 2 e preserva snapshot de sessão anterior com 3', async () => {
    const sessions = new SessionsRepository(db.connection),
      catalog = new ExercisesRepository(db.connection),
      schedule = new WorkoutScheduleRepository(db.connection);
    const day = await planWith(['builtin-bench', 'builtin-row', 'builtin-press']);
    expect((await schedule.days()).find((d) => d.id === day)?.exercise_count).toBe(3);
    const id = await sessions.start(day),
      before = await sessions.get(id);
    expect(before.exercises).toHaveLength(3);
    await sessions.finish(id);
    await catalog.archive('builtin-row');
    expect((await schedule.days()).find((d) => d.id === day)?.exercise_count).toBe(2);
    const nextWeek = addDays(localDate(), 7);
    expect(
      (await schedule.range(nextWeek, nextWeek)).find((d) => d.day_id === day)?.exercise_count,
    ).toBe(2);
    expect((await sessions.get(id)).exercises).toEqual(before.exercises);
    expect((await sessions.get(id)).sets).toEqual(before.sets);
    const next = await sessions.start(day),
      latest = await sessions.get(next);
    expect(latest.exercises).toHaveLength(2);
    expect(latest.exercises.some((e) => e.exercise_id === 'builtin-row')).toBe(false);
    expect(
      (await sessions.get(id)).exercises.find((e) => e.exercise_id === 'builtin-row')
        ?.exercise_name,
    ).toBe('Remada baixa');
  });
  it('copiar treino anterior atualiza os campos antes de editar e não perde a carga copiada', async () => {
    const user = userEvent.setup(),
      sessions = new SessionsRepository(db.connection),
      day = await planWith(['builtin-bench']);
    const first = await sessions.start(day);
    const priorSet = (await sessions.get(first)).sets[0];
    await sessions.saveSet(priorSet.id, {
      load_value: 30,
      reps: 8,
      completed: 1,
      load_type: 'per_side',
      set_type: 'normal',
      notes: '',
    });
    await sessions.finish(first);
    const second = await sessions.start(day);
    render(<SessionEditor id={second} onBack={() => {}} />);
    const copy = await screen.findByRole('button', { name: 'Usar cargas anteriores' });
    await user.click(copy);
    expect(
      ((await screen.findByRole('textbox', { name: 'Série 1: carga' })) as HTMLInputElement).value,
    ).toBe('30');
    const reps = screen.getByRole('textbox', { name: 'Série 1: repetições' });
    await user.clear(reps);
    await user.type(reps, '9');
    await user.click(screen.getByRole('checkbox', { name: 'Série 1: concluída' }));
    await act(async () => {
      await flushWorkouts();
    });
    expect((await sessions.get(second)).sets[0]).toMatchObject({
      load_value: 30,
      reps: 9,
      completed: 1,
    });
  });
});
