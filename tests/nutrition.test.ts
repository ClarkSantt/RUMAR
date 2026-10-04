import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { database } from './database';
import { NutritionRepository, SqlFoodSource } from '../src/features/nutrition/repository';
import { positiveNumber, portion, remaining, sumNutrients } from '../src/features/nutrition/domain';
import { Repository } from '../src/services/repository';
import { PlansRepository } from '../src/features/workouts/repositories/plans';

describe('Alimentação e TACO no SQLite real', () => {
  let db: ReturnType<typeof database>, repo: NutritionRepository;
  beforeEach(() => {
    db = database();
    repo = new NutritionRepository(db.connection);
  });
  afterEach(() => db.sqlite.close());

  it('importa a TACO inteira uma vez e preserva fonte e base de 100 g', async () => {
    expect(db.sqlite.prepare("SELECT count(*) n FROM foods WHERE source_id='taco'").get()?.n).toBe(
      597,
    );
    const arroz = (await repo.searchFoods('Arroz, integral, cozido'))[0];
    expect(arroz.source_item_id).toBe('1');
    expect(arroz.base_amount).toBe(100);
    expect(arroz.base_unit).toBe('g');
    expect(
      (await new SqlFoodSource('taco', db.connection).search('frango')).length,
    ).toBeGreaterThan(0);
    expect((await repo.searchFoods('Frango, peito, sem pele, grelhado'))[0].category).toBe(
      'Carnes e derivados',
    );
    expect((await repo.searchFoods('banana', 'custom')).length).toBe(0);
  });
  it('não inventa micronutrientes indisponíveis e mantém traço separado', async () => {
    const arroz = (await repo.searchFoods('Arroz, integral, cozido'))[0];
    const nutrients = await repo.nutrients(arroz.id);
    expect(nutrients.energy_kcal).toBeCloseTo(123.534893, 4);
    expect(nutrients.vitamin_b12_mcg).toBeUndefined();
    const traces = db.sqlite
      .prepare("SELECT count(*) n FROM food_nutrients WHERE qualifier='trace'")
      .get() as { n: number };
    expect(traces.n).toBeGreaterThan(0);
  });
  it('aceita decimal pt-BR e rejeita NaN e unidades sem gramagem', () => {
    expect(positiveNumber('27,5')).toBe(27.5);
    expect(() => positiveNumber('NaN')).toThrow();
    expect(() => positiveNumber('0')).toThrow();
    expect(portion({ protein_g: 10 }, 150, 100).protein_g).toBe(15);
    expect(remaining(976, 2074)).toBe(1098);
  });
  it('cria, edita e arquiva alimento personalizado com nutrientes atômicos', async () => {
    const id = await repo.saveCustomFood({
      name: 'Whey próprio',
      base_amount: 30,
      base_unit: 'g',
      nutrients: { energy_kcal: 120, protein_g: 24, calcium_mg: 100 },
    });
    expect((await repo.nutrients(id)).protein_g).toBe(24);
    await repo.saveCustomFood(
      {
        name: 'Whey corrigido',
        base_amount: 30,
        base_unit: 'g',
        nutrients: { energy_kcal: 118, protein_g: 25 },
      },
      id,
    );
    expect((await repo.nutrients(id)).calcium_mg).toBeUndefined();
    expect((await repo.nutrients(id)).protein_g).toBe(25);
    await repo.archiveCustomFood(id);
    expect(await repo.searchFoods('Whey corrigido')).toHaveLength(0);
  });
  it('usa gramagem explícita para base em porção sem supor conversão', async () => {
    await expect(
      repo.saveCustomFood({
        name: 'Produto sem gramagem',
        base_amount: 1,
        base_unit: 'porção',
        nutrients: { energy_kcal: 120 },
      }),
    ).rejects.toThrow('Equivalente em gramas');
    const id = await repo.saveCustomFood({
      name: 'Barra própria',
      base_amount: 1,
      base_unit: 'porção',
      base_grams_equivalent: 30,
      nutrients: { energy_kcal: 120, protein_g: 10 },
    });
    const meal = await repo.saveMeal('Lanche');
    await repo.saveMealItem(meal, {
      food_id: id,
      quantity: 2,
      unit: 'porção',
      grams_equivalent: 60,
    });
    expect((await repo.mealTotals(meal)).energy_kcal).toBe(240);
    await repo.saveDiaryEntry('2026-09-27', 'Lanche', {
      food_id: id,
      quantity: 2,
      unit: 'porção',
      grams_equivalent: 60,
    });
    expect((await repo.diaryTotals('2026-09-27')).protein_g).toBe(20);
  });
  it('calcula refeição proporcional e agrega micros sem transformar ausência em zero', async () => {
    const banana = (await repo.searchFoods('Banana, prata, crua'))[0];
    const aveia = (await repo.searchFoods('Aveia, flocos, crua'))[0];
    const meal = await repo.saveMeal('Café da manhã');
    const bananaItem = await repo.saveMealItem(meal, {
      food_id: banana.id,
      quantity: 100,
      unit: 'g',
      grams_equivalent: 100,
    });
    await repo.saveMealItem(meal, {
      food_id: aveia.id,
      quantity: 40,
      unit: 'g',
      grams_equivalent: 40,
    });
    const expected = sumNutrients([
      await repo.nutrients(banana.id),
      portion(await repo.nutrients(aveia.id), 40, 100),
    ]);
    expect((await repo.mealTotals(meal)).energy_kcal).toBeCloseTo(expected.energy_kcal!, 4);
    expect((await repo.mealTotals(meal)).potassium_mg).toBeCloseTo(expected.potassium_mg!, 4);
    await repo.saveMealItem(
      meal,
      { food_id: banana.id, quantity: 150, unit: 'g', grams_equivalent: 150 },
      bananaItem,
    );
    expect((await repo.mealTotals(meal)).energy_kcal).toBeGreaterThan(expected.energy_kcal!);
    await repo.removeMealItem(bananaItem);
    expect(await repo.mealItems(meal)).toHaveLength(1);
  });
  it('planeja sete dias, soma dieta diária e gera compras em gramas', async () => {
    const arroz = (await repo.searchFoods('Arroz, integral, cozido'))[0];
    const meal = await repo.saveMeal('Almoço');
    await repo.saveMealItem(meal, {
      food_id: arroz.id,
      quantity: 150,
      unit: 'g',
      grams_equivalent: 150,
    });
    const plan = await repo.savePlan('Dieta atual');
    await repo.activatePlan(plan);
    await repo.addPlanMeal(plan, 1, meal);
    await repo.addPlanMeal(plan, 2, meal);
    expect((await repo.planDayTotals(plan, 1)).energy_kcal).toBeCloseTo(
      (await repo.nutrients(arroz.id)).energy_kcal! * 1.5,
      4,
    );
    expect((await repo.shoppingForPlan(plan))[0].grams).toBe(300);
    expect((await repo.plans())[0].active).toBe(1);
  });
  it('mantém dieta separada do diário e snapshot confiável após editar alimento', async () => {
    const food = await repo.saveCustomFood({
      name: 'Produto',
      base_amount: 100,
      base_unit: 'g',
      nutrients: { energy_kcal: 100, protein_g: 5 },
    });
    const meal = await repo.saveMeal('Lanche');
    await repo.saveMealItem(meal, { food_id: food, quantity: 50, unit: 'g', grams_equivalent: 50 });
    const plan = await repo.savePlan('Base');
    await repo.addPlanMeal(plan, 1, meal);
    expect((await repo.diaryTotals('2026-09-28')).energy_kcal).toBeUndefined();
    await repo.copyMealToDiary(meal, '2026-09-28');
    expect((await repo.diaryTotals('2026-09-28')).energy_kcal).toBe(50);
    await repo.saveCustomFood(
      {
        name: 'Produto novo',
        base_amount: 100,
        base_unit: 'g',
        nutrients: { energy_kcal: 200, protein_g: 10 },
      },
      food,
    );
    expect((await repo.diaryTotals('2026-09-28')).energy_kcal).toBe(50);
    expect((await repo.planDayTotals(plan, 1)).energy_kcal).toBe(100);
  });
  it('edita e remove registro diário recalculando macros e micros', async () => {
    const food = (await repo.searchFoods('Aveia, flocos, crua'))[0];
    const id = await repo.saveDiaryEntry('2026-09-27', 'Café da manhã', {
      food_id: food.id,
      quantity: 40,
      unit: 'g',
      grams_equivalent: 40,
    });
    const before = await repo.diaryTotals('2026-09-27');
    await repo.saveDiaryEntry(
      '2026-09-27',
      'Café da manhã',
      { food_id: food.id, quantity: 80, unit: 'g', grams_equivalent: 80 },
      id,
    );
    const after = await repo.diaryTotals('2026-09-27');
    expect(after.energy_kcal).toBeCloseTo(before.energy_kcal! * 2, 4);
    expect(after.iron_mg).toBeCloseTo(before.iron_mg! * 2, 4);
    await repo.removeDiaryEntry(id);
    expect((await repo.diaryTotals('2026-09-27')).energy_kcal).toBeUndefined();
  });
  it('salva metas e calcula restante corretamente', async () => {
    await repo.saveGoals({ calories: 2074, carbs_g: 260, protein_g: 104, fat_g: 70 });
    expect(remaining(976, (await repo.goals()).calories)).toBe(1098);
    await repo.saveGoals({ calories: null, carbs_g: null, protein_g: 120, fat_g: null });
    expect((await repo.goals()).calories).toBeNull();
  });
  it('registra, edita, lista e apaga peso', async () => {
    const id = await repo.saveWeight('2026-09-27', '72,5');
    expect((await repo.weights())[0].weight_kg).toBe(72.5);
    await repo.saveWeight('2026-09-26', '72,1', 'corrigido', id);
    expect((await repo.weights())[0].entry_date).toBe('2026-09-26');
    await repo.removeWeight(id);
    expect(await repo.weights()).toHaveLength(0);
  });
});

it('upgrade Fase 3 → Fase 4 preserva dados antigos e aplicação é única', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'rumo-nutrition-')),
    path = join(folder, 'upgrade.db');
  let db = database(path, 3);
  try {
    const core = new Repository(db.connection),
      plans = new PlansRepository(db.connection);
    await core.createTask({
      title: 'Tarefa antiga',
      description: '',
      priority: 'normal',
      due_date: null,
      due_time: null,
      recurrence: null,
    });
    const plan = await plans.save({ name: 'Upper', description: '', habit_id: null });
    db.sqlite.exec(`
      INSERT INTO inbox_items(id,content,created_at,updated_at) VALUES('old-inbox','Ideia','2026-09-27','2026-09-27');
      INSERT INTO projects(id,name,created_at,updated_at) VALUES('old-project','Projeto','2026-09-27','2026-09-27');
      INSERT INTO habits(id,name,frequency,kind,start_date,created_at,updated_at)
       VALUES('old-habit','Hábito','daily','boolean','2026-09-01','2026-09-27','2026-09-27');
      INSERT INTO routines(id,name,frequency,created_at,updated_at)
       VALUES('old-routine','Rotina','daily','2026-09-27','2026-09-27');
      INSERT INTO thoughts(id,title,content,created_at,updated_at)
       VALUES('old-thought','Pensamento','Texto','2026-09-27','2026-09-27');
      UPDATE settings SET value='Pessoa' WHERE key='name';
    `);
    const tables = [
      'tasks',
      'subtasks',
      'task_completions',
      'inbox_items',
      'settings',
      'projects',
      'habits',
      'routines',
      'thoughts',
      'exercises',
      'workout_plans',
    ];
    const before = Object.fromEntries(
      tables.map((t) => [t, db.sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
    );
    db.sqlite.close();
    db = database(path, 5);
    for (const table of tables)
      expect(db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(
        before[table],
      );
    expect(db.sqlite.prepare('SELECT count(*) n FROM test_migrations').get()).toEqual({ n: 5 });
    expect(
      (await new NutritionRepository(db.connection).searchFoods('Arroz')).length,
    ).toBeGreaterThan(0);
    expect((await new PlansRepository(db.connection).list()).some((x) => x.id === plan)).toBe(true);
    db.sqlite.close();
    db = database(path, 5);
    expect(db.sqlite.prepare("SELECT count(*) n FROM foods WHERE source_id='taco'").get()).toEqual({
      n: 597,
    });
  } finally {
    db.sqlite.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it('upgrade 0004 → 0005 mantém catálogo e normaliza base em gramas dos personalizados', () => {
  const folder = mkdtempSync(join(tmpdir(), 'rumo-units-')),
    path = join(folder, 'nutrition.db');
  let db = database(path, 4);
  try {
    db.sqlite.exec(`INSERT INTO foods(id,source_id,name,base_amount,base_unit,is_custom,
      custom_nutrients_json,created_at,updated_at) VALUES
      ('old-custom','custom','Barra antiga',30,'g',1,'{"energy_kcal":120}',
      '2026-09-27','2026-09-27')`);
    const before = db.sqlite
      .prepare('SELECT * FROM food_nutrients WHERE food_id=?')
      .all('old-custom');
    db.sqlite.close();
    db = database(path, 5);
    expect(
      db.sqlite.prepare('SELECT base_grams_equivalent FROM foods WHERE id=?').get('old-custom'),
    ).toEqual({ base_grams_equivalent: 30 });
    expect(
      db.sqlite.prepare('SELECT * FROM food_nutrients WHERE food_id=?').all('old-custom'),
    ).toEqual(before);
    expect(db.sqlite.prepare("SELECT count(*) n FROM foods WHERE source_id='taco'").get()).toEqual({
      n: 597,
    });
  } finally {
    db.sqlite.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
