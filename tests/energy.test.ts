import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from './database';
import {
  ageOn,
  automaticStepAdjustment,
  desiredBalance,
  generalProfile,
  macroGoals,
  restingEnergy,
  stepAdjustment,
  validateProfile,
  workoutCalories,
  type EnergyProfile,
} from '../src/features/energy/domain';
import { EnergyRepository } from '../src/features/energy/repository';
import { BodyProgressRepository } from '../src/features/body-progress/repository';
import { PlansRepository } from '../src/features/workouts/repositories/plans';
import { SessionsRepository } from '../src/features/workouts/repositories/sessions';
import { WorkoutScheduleRepository } from '../src/features/workouts/repositories/schedule';
import { NutritionRepository } from '../src/features/nutrition/repository';
import { CalendarPreferences } from '../src/features/calendar/preferences';
import { calendarRange } from '../src/features/calendar/repository';
import { HabitsRepository } from '../src/features/habits/repository';
import { addDays, localDate } from '../src/lib/dates';
const profile: EnergyProfile = {
  birth_date: '1996-09-27',
  height_cm: 180,
  biological_parameter: 'male',
  method: 'mifflin',
  base_factor: 1.2,
  habitual_steps: 7000,
  step_adjustment: true,
  kcal_per_1000_steps: 40,
  objective: 'lose',
  balance: 2100,
  balance_period: 'week',
  dynamic_goals: true,
  macro_strategy: 'manual',
  protein: 180,
  carbs: 250,
  fat: 70,
};
describe('energia transparente e planejamento 1.1', () => {
  it('perfil geral usa peso compartilhado, TMB e meta automática sem configuração técnica', async () => {
    const db = database();
    try {
      const repo = new EnergyRepository(db.connection);
      const p = generalProfile('1996-09-27', 180, 'male', 'lose');
      await repo.saveProfile(p);
      await new BodyProgressRepository(db.connection).save('2026-09-27', { weight: '80,0' });
      let day = await repo.day('2026-09-27');
      expect(day.resting).toBe(1780);
      expect(day.target).toBeCloseTo(1886);
      expect(desiredBalance(p)).toBe(-250);
      await new BodyProgressRepository(db.connection).save('2026-09-27', { weight: '81,0' });
      day = await repo.day('2026-09-27');
      expect(day.weight).toBe(81);
      expect(day.resting).toBe(1790);
      expect(day.target).toBeCloseTo(1898);
      expect(await new BodyProgressRepository(db.connection).weights(1)).toMatchObject([
        { weight_kg: 81 },
      ]);
      expect((await repo.profile())?.automatic).toBe(true);
    } finally {
      db.sqlite.close();
    }
  });
  it('passos observados ajustam somente a diferença da referência e recalculam ao editar', async () => {
    const db = database();
    try {
      const repo = new EnergyRepository(db.connection);
      await repo.saveProfile(generalProfile('1996-09-27', 180, 'male', 'maintain'));
      await new BodyProgressRepository(db.connection).save('2026-09-27', { weight: 80 });
      expect(automaticStepAdjustment(80, 10000)).toBe(140);
      await repo.activity('2026-09-27', 10000);
      expect((await repo.day('2026-09-27')).step_adjustment).toBe(140);
      await repo.activity('2026-09-27', 8500);
      expect((await repo.day('2026-09-27')).step_adjustment).toBe(98);
      expect((await repo.averages('2026-09-27'))[0]).toMatchObject({ days: 1, average: 8500 });
    } finally {
      db.sqlite.close();
    }
  });
  it('estima gasto de treino concluído automaticamente uma única vez e evita sobreposição de passos', async () => {
    const db = database();
    try {
      const repo = new EnergyRepository(db.connection);
      await repo.saveProfile(generalProfile('1996-09-27', 180, 'male', 'maintain'));
      await new BodyProgressRepository(db.connection).save(localDate(), { weight: 80 });
      const plans = new PlansRepository(db.connection);
      const plan = await plans.save({ name: 'A', description: '', habit_id: null });
      const dayId = await plans.saveDay(plan, { name: 'Upper', weekday: null, notes: '' });
      await plans.saveExercise(dayId, {
        exercise_id: 'builtin-bench',
        target_sets: 1,
        min_reps: 6,
        max_reps: 10,
        rest_seconds: 90,
        notes: '',
      });
      const sessions = new SessionsRepository(db.connection);
      const id = await sessions.start(dayId);
      db.sqlite
        .prepare('UPDATE workout_sessions SET started_at=? WHERE id=?')
        .run(new Date(Date.now() - 60 * 60000).toISOString(), id);
      await repo.activity(localDate(), 10000);
      expect((await repo.day(localDate())).completed_workout).toBe(0);
      await sessions.finish(id);
      const result = await repo.day(localDate());
      expect(result.completed_workout).toBeCloseTo(210, 0);
      expect(result.step_adjustment).toBe(0);
      expect(result.step_adjustment_withheld).toBe(true);
      expect(await repo.sessionEstimate(id)).toBeCloseTo(result.completed_workout, 1);
      await repo.activity(localDate(), 10000, '', 3000);
      expect((await repo.day(localDate())).step_adjustment).toBe(56);
      await repo.saveEnergy('session', id, {
        method: 'manual',
        calories: 300,
        met: null,
        minutes: null,
      });
      expect((await repo.day(localDate())).completed_workout).toBe(300);
      await sessions.remove(id);
      expect((await repo.day(localDate())).completed_workout).toBe(0);
    } finally {
      db.sqlite.close();
    }
  });
  it('calcula Mifflin masculino/feminino e aniversário corretamente', () => {
    expect(restingEnergy(profile, 80, '2026-09-27')).toBe(1780);
    expect(restingEnergy({ ...profile, biological_parameter: 'female' }, 80, '2026-09-27')).toBe(
      1614,
    );
    expect(ageOn(profile.birth_date, '2026-09-26')).toBe(29);
    expect(restingEnergy(profile, 80, '2026-09-26')).toBe(1785);
  });
  it('recalcula peso e altura sem armazenar TMB', () => {
    expect(restingEnergy(profile, 81, '2026-09-27')).toBe(1790);
    expect(restingEnergy({ ...profile, height_cm: 184 }, 80, '2026-09-27')).toBe(1805);
  });
  it('rejeita datas inválidas, NaN e percentuais incompletos', () => {
    expect(() => validateProfile({ ...profile, birth_date: '2026-02-30' }, localDate())).toThrow();
    expect(() => validateProfile({ ...profile, height_cm: NaN }, localDate())).toThrow();
    expect(() =>
      validateProfile(
        { ...profile, macro_strategy: 'percent', protein: 30, carbs: 45, fat: 20 },
        localDate(),
      ),
    ).toThrow(/100/);
  });
  it('ajusta somente a diferença de passos e permite desligar', () => {
    expect(stepAdjustment(profile, 10000)).toBe(120);
    expect(stepAdjustment(profile, 8500)).toBe(60);
    expect(stepAdjustment(profile, 4000)).toBe(-120);
    expect(stepAdjustment(profile, null)).toBe(0);
    expect(stepAdjustment({ ...profile, step_adjustment: false }, 10000)).toBe(0);
  });
  it('não presume coeficiente de passos', () => {
    expect(() => validateProfile({ ...profile, kcal_per_1000_steps: null }, localDate())).toThrow();
    expect(() =>
      validateProfile(
        { ...profile, step_adjustment: false, kcal_per_1000_steps: null },
        localDate(),
      ),
    ).not.toThrow();
  });
  it('normaliza manutenção, déficit e superávit semanal', () => {
    expect(desiredBalance(profile)).toBe(-300);
    expect(desiredBalance({ ...profile, objective: 'gain', balance: 1400 })).toBe(200);
    expect(desiredBalance({ ...profile, objective: 'maintain' })).toBe(0);
    expect(desiredBalance({ ...profile, objective: 'custom', balance: -1400 })).toBe(-200);
  });
  it('calcula macros manuais e calorias 4/4/9', () => {
    expect(macroGoals(profile, 2400, 80)).toMatchObject({
      protein_g: 180,
      carbs_g: 250,
      fat_g: 70,
      macro_calories: 2350,
    });
  });
  it('percentuais acompanham meta dinâmica', () => {
    const p = { ...profile, macro_strategy: 'percent' as const, protein: 30, carbs: 45, fat: 25 };
    expect(macroGoals(p, 2400, 80)).toMatchObject({ protein_g: 180, carbs_g: 270 });
    expect(macroGoals(p, 2000, 80).protein_g).toBe(150);
  });
  it('g/kg acompanha peso e carboidratos restantes nunca são negativos', () => {
    const p = { ...profile, macro_strategy: 'per_kg' as const, protein: 2, fat: 1 };
    expect(macroGoals(p, 2400, 80)).toMatchObject({ protein_g: 160, fat_g: 80, carbs_g: 260 });
    expect(macroGoals(p, 2400, 90).protein_g).toBe(180);
    expect(macroGoals(p, 500, 80)).toMatchObject({ carbs_g: 0, insufficient: true });
  });
  it('MET contabiliza energia líquida adicional e manual substitui a estimativa', () => {
    expect(
      workoutCalories({ method: 'estimated', met: 3.5, minutes: 60, calories: null }, 80),
    ).toBe(210);
    expect(workoutCalories({ method: 'manual', met: 6, minutes: 60, calories: 420 }, 80)).toBe(420);
    expect(workoutCalories({ method: 'off', met: 6, minutes: 60, calories: 420 }, 80)).toBe(0);
  });
  it('não calcula NaN sem configuração ou peso', async () => {
    const db = database();
    const r = new EnergyRepository(db.connection);
    expect(await r.day('2026-09-27')).toMatchObject({ target: null, resting: null, balance: null });
    await r.saveProfile(profile);
    expect((await r.day('2026-09-27')).target).toBeNull();
    db.sqlite.close();
  });
  it('passos são únicos por dia, editáveis e média usa somente registros reais', async () => {
    const db = database();
    const r = new EnergyRepository(db.connection);
    await r.activity('2026-09-27', 10000);
    await r.activity('2026-09-27', 8500);
    await r.activity('2026-09-26', 7000);
    expect((await r.averages('2026-09-27'))[0]).toMatchObject({ days: 2, average: 7750 });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM daily_activity_entries').get()?.n).toBe(2);
    await expect(r.activity('2026-09-27', NaN)).rejects.toThrow();
    db.sqlite.close();
  });
  it('desconta passos incluídos em treino para não contar a atividade duas vezes', async () => {
    const db = database();
    const r = new EnergyRepository(db.connection);
    await r.saveProfile(profile);
    await new BodyProgressRepository(db.connection).save('2026-09-27', { weight: 80 });
    await r.activity('2026-09-27', 10000, '', 3000);
    expect((await r.day('2026-09-27')).step_adjustment).toBe(0);
    expect((await r.activityEntry('2026-09-27'))?.workout_steps).toBe(3000);
    await r.activity('2026-09-27', 10000, '', 1500);
    expect((await r.day('2026-09-27')).step_adjustment).toBe(60);
    await expect(r.activity('2026-09-27', 10000, '', 10001)).rejects.toThrow();
    db.sqlite.close();
  });
  it('múltiplos weekdays atualizam agenda e calendário sem restart', async () => {
    const db = database();
    const r = new PlansRepository(db.connection);
    const p = await r.save({
      name: 'A/B/C/Upper/Lower',
      description: '',
      habit_id: null,
      activate: true,
    });
    const d = await r.saveDay(p, { name: 'Upper', weekday: null, weekdays: [1, 5], notes: '' });
    const s = new WorkoutScheduleRepository(db.connection);
    expect((await s.range('2026-09-21', '2026-09-27')).map((x) => x.date)).toEqual([
      '2026-09-21',
      '2026-09-25',
    ]);
    await r.saveDay(p, { name: 'Upper', weekday: null, weekdays: [4], notes: '' }, d);
    expect(
      (await calendarRange(db.connection, '2026-09-21', '2026-09-27'))
        .filter((x) => x.kind === 'workout')
        .map((x) => x.date),
    ).toEqual(['2026-09-24']);
    db.sqlite.close();
  });
  it('reabre plano A/B/C/Upper/Lower com divisão, dias e exercícios preservados', async () => {
    const area = mkdtempSync(join(tmpdir(), 'rumo-plan-v110-'));
    const path = join(area, 'plan.db');
    try {
      let db = database(path);
      const repo = new PlansRepository(db.connection);
      const plan = await repo.save({
        name: 'A/B/C/Upper/Lower',
        description: '',
        habit_id: null,
        activate: true,
      });
      const names = ['A', 'B', 'C', 'Upper', 'Lower'];
      const weekdays = [1, 2, 3, 5, 6];
      for (let i = 0; i < names.length; i++) {
        const id = await repo.saveDay(plan, {
          name: names[i],
          weekday: null,
          weekdays: [weekdays[i]],
          notes: '',
        });
        await repo.saveExercise(id, {
          exercise_id: 'builtin-bench',
          target_sets: 3,
          min_reps: 6,
          max_reps: 10,
          rest_seconds: 90,
          notes: '',
        });
      }
      db.sqlite.close();
      db = database(path);
      const days = await new PlansRepository(db.connection).days(plan);
      expect(days.map((day) => [day.name, day.weekdays, day.exercise_count])).toEqual(
        names.map((name, i) => [name, [weekdays[i]], 1]),
      );
      expect(
        (await new WorkoutScheduleRepository(db.connection).range('2026-09-21', '2026-09-27')).map(
          (item) => item.name,
        ),
      ).toEqual(names);
      db.sqlite.close();
    } finally {
      rmSync(area, { recursive: true, force: true });
    }
  });
  it('ativar novo plano preserva o anterior e impede dois ativos', async () => {
    const db = database();
    const r = new PlansRepository(db.connection);
    await r.save({ name: 'Antigo', description: '', habit_id: null, activate: true });
    await r.save({ name: 'Novo', description: '', habit_id: null, activate: true });
    const rows = await r.list();
    expect(rows).toHaveLength(2);
    expect(rows.filter((p) => p.active)).toHaveLength(1);
    db.sqlite.close();
  });
  it('sessão concluída entra uma vez, correção/exclusão recalculam energia', async () => {
    const db = database();
    const r = new EnergyRepository(db.connection);
    const plans = new PlansRepository(db.connection);
    await r.saveProfile(profile);
    const day = localDate();
    await new BodyProgressRepository(db.connection).save(day, { weight: 80 });
    const p = await plans.save({ name: 'Plano', description: '', habit_id: null, activate: true });
    const d = await plans.saveDay(p, { name: 'Upper', weekday: null, notes: '' });
    await plans.saveExercise(d, {
      exercise_id: 'builtin-bench',
      target_sets: 3,
      min_reps: 6,
      max_reps: 10,
      rest_seconds: 90,
      notes: '',
    });
    await r.saveEnergy('day', d, { method: 'manual', minutes: null, met: null, calories: 420 });
    const sessions = new SessionsRepository(db.connection);
    const id = await sessions.start(d);
    expect((await r.day(day)).completed_workout).toBe(0);
    const set = (await sessions.get(id)).sets[0];
    await sessions.saveSet(set.id, {
      load_value: 30,
      load_type: 'per_side',
      reps: 8,
      completed: 1,
      set_type: 'normal',
      notes: '',
    });
    await sessions.finish(id);
    await sessions.finish(id);
    expect((await r.day(day)).completed_workout).toBe(420);
    await r.saveEnergy('session', id, {
      method: 'manual',
      minutes: null,
      met: null,
      calories: 300,
    });
    expect((await r.day(day)).completed_workout).toBe(300);
    await sessions.remove(id);
    expect((await r.day(day)).completed_workout).toBe(0);
    db.sqlite.close();
  });
  it('balanço de sete dias agrega ingestão real sem incluir dia ausente', async () => {
    const db = database();
    const r = new EnergyRepository(db.connection);
    await r.saveProfile({ ...profile, birth_date: '1996-01-01' });
    await new BodyProgressRepository(db.connection).save('2026-09-20', { weight: 80 });
    for (let i = 0; i < 7; i++) {
      const day = addDays('2026-09-21', i);
      await r.activity(day, 7000);
      db.sqlite
        .prepare(
          "INSERT INTO food_diary_entries(id,entry_date,meal_label,food_id,food_name,quantity,unit,grams_equivalent,nutrients_json,created_at,updated_at) VALUES(?,?,'Almoço','taco:1','Teste',1,'g',1,?,'now','now')",
        )
        .run(day, day, JSON.stringify({ energy_kcal: 1800 + i * 10 }));
    }
    const rows = await r.range('2026-09-21', '2026-09-27');
    expect(rows.map((r) => r.balance)).toEqual([-336, -326, -316, -306, -296, -286, -276]);
    expect(rows.reduce((s, r) => s + r.balance!, 0)).toBe(-2142);
    expect(rows.reduce((s, r) => s + r.balance!, 0) / 7).toBe(-306);
    expect((await r.day('2026-09-28')).balance).toBeNull();
    db.sqlite.close();
  });
  it('meta dinâmica integra Nutrition sem substituir metas manuais persistidas', async () => {
    const db = database();
    const r = new EnergyRepository(db.connection),
      n = new NutritionRepository(db.connection);
    await n.saveGoals({ calories: 2000, carbs_g: 200, protein_g: 100, fat_g: 60 });
    await r.saveProfile(profile);
    await new BodyProgressRepository(db.connection).save('2026-09-27', { weight: 80 });
    await r.activity('2026-09-27', 10000);
    expect((await n.daySummary('2026-09-27'))[1].calories).toBe(1956);
    expect((await n.goals()).calories).toBe(2000);
    await r.saveProfile({ ...profile, dynamic_goals: false });
    expect((await n.daySummary('2026-09-27'))[1].calories).toBe(2000);
    db.sqlite.close();
  });
  it('visibilidade individual e global não alteram hábitos nem recorrência', async () => {
    const db = database();
    const h = new HabitsRepository(db.connection);
    const id = await h.save({
      name: 'Água',
      description: '',
      frequency: 'daily',
      weekdays: [],
      weekly_target: 1,
      kind: 'boolean',
      target_value: 1,
      unit: '',
      start_date: '2026-09-01',
      end_date: null,
      project_id: null,
      active: 1,
    });
    const prefs = new CalendarPreferences(db.connection);
    expect(
      (await calendarRange(db.connection, '2026-09-27', '2026-09-27')).some((x) => x.id === id),
    ).toBe(true);
    await prefs.item('habit', id, false);
    expect(
      (await calendarRange(db.connection, '2026-09-27', '2026-09-27')).some((x) => x.id === id),
    ).toBe(false);
    expect((await h.list()).some((x) => x.id === id)).toBe(true);
    await prefs.source('habit', false);
    await prefs.item('habit', id, true);
    expect(
      (await calendarRange(db.connection, '2026-09-27', '2026-09-27')).some((x) => x.id === id),
    ).toBe(false);
    await prefs.source('habit', true);
    expect(
      (await calendarRange(db.connection, '2026-09-27', '2026-09-27')).some((x) => x.id === id),
    ).toBe(true);
    db.sqlite.close();
  });
  it('upgrade 9→10→11 e reabertura preservam dados, weekdays e preferências', async () => {
    const area = mkdtempSync(join(tmpdir(), 'rumo-1-1-'));
    const path = join(area, 'test.db');
    let open: ReturnType<typeof database> | null = null;
    try {
      let db = (open = database(path, 9));
      db.sqlite.exec(
        "INSERT INTO workout_plans(id,name,active,created_at,updated_at) VALUES('p','Plano',1,'now','now');INSERT INTO workout_days(id,workout_plan_id,name,weekday,created_at,updated_at) VALUES('d','p','Upper',5,'now','now')",
      );
      const tables = db.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name!='test_migrations'")
        .all() as { name: string }[];
      const before = Object.fromEntries(
        tables.map((t) => [t.name, db.sqlite.prepare(`SELECT * FROM ${t.name}`).all()]),
      );
      db.sqlite.close();
      db = open = database(path, 10);
      for (const t of tables) {
        const actual = db.sqlite.prepare(`SELECT * FROM ${t.name}`).all();
        expect(
          actual.map((row) => {
            const r = { ...row };
            delete r.pending_weekdays;
            return r;
          }),
        ).toEqual(before[t.name]);
      }
      expect((await new PlansRepository(db.connection).days('p'))[0].weekdays).toEqual([5]);
      const r = new EnergyRepository(db.connection);
      await r.saveProfile(profile);
      db.sqlite
        .prepare(
          "INSERT INTO daily_activity_entries(entry_date,steps,created_at,updated_at) VALUES('2026-09-27',8426,'now','now')",
        )
        .run();
      await new CalendarPreferences(db.connection).source('habit', false);
      db.sqlite.close();
      db = open = database(path, 11);
      expect(await new EnergyRepository(db.connection).profile()).toEqual(profile);
      expect((await new EnergyRepository(db.connection).day('2026-09-27')).steps).toBe(8426);
      expect(
        (await new EnergyRepository(db.connection).activityEntry('2026-09-27'))?.workout_steps,
      ).toBe(0);
      expect(await new CalendarPreferences(db.connection).sources()).toEqual([
        { source_type: 'habit', visible: 0 },
      ]);
      expect(db.sqlite.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
    } finally {
      if (open) open.sqlite.close();
      rmSync(area, { recursive: true, force: true });
    }
  });
});
