import { describe, expect, it } from 'vitest';
import { database } from './database';
import { globalSearch } from '../src/features/search/repository';
import { Repository } from '../src/services/repository';
import { NutritionRepository } from '../src/features/nutrition/repository';
import { FinanceRepository } from '../src/features/finance/repository';
import { calendarRange } from '../src/features/calendar/repository';
import { homeOverview } from '../src/features/home/repository';

describe('perfil sintético isolado', () => {
  it('mantém consultas principais utilizáveis com vários anos de dados', async () => {
    const { sqlite, connection } = database();
    const stamp = '2026-09-27T12:00:00Z';
    sqlite.exec('BEGIN');
    const task = sqlite.prepare(
      'INSERT INTO tasks(id,title,due_date,created_at,updated_at) VALUES(?,?,?,?,?)',
    );
    for (let i = 0; i < 5000; i++) task.run(`task-${i}`, `Tarefa ${i}`, '2026-09-27', stamp, stamp);
    const thought = sqlite.prepare(
      'INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES(?,?,?,?,?)',
    );
    for (let i = 0; i < 1000; i++)
      thought.run(`thought-${i}`, `Pensamento ${i}`, 'conteúdo sintético', stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES('account','Conta','checking',?,?)",
      )
      .run(stamp, stamp);
    const transaction = sqlite.prepare(
      "INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,description,normalized_description,created_at,updated_at) VALUES(?,'account','2026-09-27',100,'expense',?,'COMPRA TESTE',?,?)",
    );
    for (let i = 0; i < 10000; i++)
      transaction.run(`transaction-${i}`, `Compra teste ${i}`, stamp, stamp);
    const foodId = (sqlite.prepare('SELECT id FROM foods LIMIT 1').get() as { id: string }).id;
    const diary = sqlite.prepare(
      'INSERT INTO food_diary_entries(id,entry_date,food_id,food_name,quantity,unit,grams_equivalent,nutrients_json,created_at,updated_at) VALUES(?, ?, ?, ?, 100, ?, 100, ?, ?, ?)',
    );
    for (let i = 0; i < 5000; i++)
      diary.run(`diary-${i}`, '2026-09-27', foodId, 'Alimento sintético', 'g', '{}', stamp, stamp);
    const workout = sqlite.prepare(
      "INSERT INTO workout_sessions(id,plan_name,day_name,session_date,started_at,finished_at,status,created_at,updated_at) VALUES(?,'Plano','Upper','2026-09-27',?,?,'completed',?,?)",
    );
    sqlite
      .prepare(
        "INSERT INTO exercises(id,name,muscle_group,equipment,load_type,created_at,updated_at) VALUES('exercise','Supino sintético','Peito','Barra','per_side',?,?)",
      )
      .run(stamp, stamp);
    const sessionExercise = sqlite.prepare(
      "INSERT INTO workout_session_exercises(id,workout_session_id,exercise_id,exercise_name,load_type,target_sets,min_reps,max_reps,sort_order) VALUES(?,?,'exercise','Supino sintético','per_side',10,6,10,0)",
    );
    const set = sqlite.prepare(
      "INSERT INTO workout_sets(id,workout_session_id,session_exercise_id,exercise_id,set_number,load_value,load_type,reps,completed,created_at,updated_at) VALUES(?,?,?,'exercise',?,30,'per_side',8,1,?,?)",
    );
    for (let i = 0; i < 1000; i++) {
      workout.run(`session-${i}`, stamp, stamp, stamp, stamp);
      sessionExercise.run(`session-exercise-${i}`, `session-${i}`);
      for (let n = 1; n <= 10; n++)
        set.run(`set-${i}-${n}`, `session-${i}`, `session-exercise-${i}`, n, stamp, stamp);
    }
    sqlite.exec('COMMIT');
    const measurements: Record<string, number> = {};
    async function measure<T>(name: string, task: () => Promise<T>) {
      const begin = performance.now();
      const result = await task();
      measurements[name] = Math.round(performance.now() - begin);
      return result;
    }
    const snapshot = await measure('startup snapshot', () => new Repository(connection).snapshot());
    expect(snapshot.tasks).toHaveLength(5000);
    const results = await measure('global search', () =>
      globalSearch(connection, 'Compra teste 9999'),
    );
    expect(results.some((row) => row.id === 'transaction-9999')).toBe(true);
    await measure('home overview', () => homeOverview(connection, '2026-09-27', '2026-10-27'));
    const calendar = await measure('calendar', () =>
      calendarRange(connection, '2026-09-01', '2026-10-12'),
    );
    expect(calendar.length).toBeGreaterThan(0);
    const foods = await measure('food search', () =>
      new NutritionRepository(connection).searchFoods('Arroz'),
    );
    expect(foods.length).toBeGreaterThan(0);
    await measure('nutrition today', () =>
      new NutritionRepository(connection).diaryTotals('2026-09-27'),
    );
    const transactions = await measure('finance transactions', () =>
      new FinanceRepository(connection).transactions({ month: '2026-09', limit: 50 }),
    );
    expect(transactions).toHaveLength(50);
    const history = await measure('workout history', () =>
      connection.select(
        "SELECT id FROM workout_sessions WHERE status='completed' ORDER BY started_at DESC LIMIT 30",
      ),
    );
    expect(history).toHaveLength(30);
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    console.info('RUMO synthetic query timings (ms):', measurements);
    sqlite.close();
  });
});
