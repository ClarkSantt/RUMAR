import { useCallback, useEffect, useState } from 'react';
import { EnergyPanel } from '../energy/EnergyPanel';
import { SaveTemplateButton } from '../templates/SaveTemplateButton';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { getDatabase } from '../../lib/database/connection';
import { addDays, localDate } from '../../lib/dates';
import {
  foodUnits,
  formatAmount,
  nutrientInfo,
  positiveNumber,
  remaining,
  type FoodUnit,
  type NutrientKey,
  type Nutrients,
} from './domain';
import { NutritionRepository } from './repository';
import type {
  Food,
  Meal,
  MealItem,
  DietPlan,
  DietMeal,
  DiaryEntry,
  Goals,
  WeightEntry,
} from './types';
import './nutrition.css';
import type { SearchResult } from '../search/repository';

type Tab = 'today' | 'diet' | 'diary' | 'foods' | 'meals' | 'weight' | 'history' | 'shopping';
const tabs: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: 'diet', label: 'Dieta' },
  { id: 'diary', label: 'Diário' },
  { id: 'foods', label: 'Alimentos' },
  { id: 'meals', label: 'Refeições' },
  { id: 'weight', label: 'Progresso' },
  { id: 'history', label: 'Histórico' },
  { id: 'shopping', label: 'Compras' },
];
const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const major: { key: NutrientKey; goal: keyof Goals }[] = [
  { key: 'carbohydrate_g', goal: 'carbs_g' },
  { key: 'protein_g', goal: 'protein_g' },
  { key: 'fat_g', goal: 'fat_g' },
];

export function NutrientSummary({
  values,
  goals,
  title = 'Resumo nutricional',
}: {
  values: Nutrients;
  goals?: Goals;
  title?: string;
}) {
  const consumed = values.energy_kcal ?? 0,
    target = goals?.calories ?? null;
  return (
    <section className="nutrition-summary" aria-label={title}>
      <div className="nutrition-calories">
        <div>
          <span className="summary-label">Calorias</span>
          <strong>
            {formatAmount(consumed, 0)} <small>kcal</small>
          </strong>
          <span>
            {target === null ? 'Sem meta definida' : `de ${formatAmount(target, 0)} kcal`}
          </span>
        </div>
        {target !== null && (
          <span className="nutrition-remaining">
            {formatAmount(remaining(consumed, target) ?? 0, 0)} kcal restantes
          </span>
        )}
      </div>
      {target !== null && (
        <progress
          max={target}
          value={Math.min(consumed, target)}
          aria-label="Progresso de calorias"
        />
      )}
      <div className="nutrition-macros">
        {major.map(({ key, goal }) => {
          const value = values[key] ?? 0,
            cap = goals?.[goal] ?? null;
          return (
            <div key={key}>
              <div className="nutrition-macro-line">
                <b>{nutrientInfo[key][0]}</b>
                <span>
                  {formatAmount(value)}
                  {cap === null ? '' : ` / ${formatAmount(cap)}`} g
                </span>
              </div>
              {cap !== null && (
                <progress
                  max={cap}
                  value={Math.min(value, cap)}
                  aria-label={`${nutrientInfo[key][0]}: ${formatAmount(value)} de ${formatAmount(cap)} g`}
                />
              )}
            </div>
          );
        })}
      </div>
      <details className="nutrition-micros">
        <summary>Micronutrientes e fibras</summary>
        <div className="nutrition-micro-grid">
          {(Object.keys(nutrientInfo) as NutrientKey[])
            .filter((key) => !['energy_kcal', 'carbohydrate_g', 'protein_g', 'fat_g'].includes(key))
            .map((key) => (
              <div key={key}>
                <span>{nutrientInfo[key][0]}</span>
                <strong>
                  {formatAmount(values[key])}{' '}
                  {values[key] === undefined ? '' : nutrientInfo[key][1]}
                </strong>
              </div>
            ))}
        </div>
        <p className="field-help">
          — indica dado não disponível; traços e ausências na fonte não são estimados.
        </p>
      </details>
    </section>
  );
}

function FoodPicker({ repo, onPick }: { repo: NutritionRepository; onPick: (food: Food) => void }) {
  const [query, setQuery] = useState(''),
    [rows, setRows] = useState<Food[]>([]);
  useEffect(() => {
    let alive = true;
    void repo.searchFoods(query).then((result) => {
      if (alive) setRows(result);
    });
    return () => {
      alive = false;
    };
  }, [repo, query]);
  return (
    <div className="nutrition-picker">
      <label>
        Buscar alimento
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Arroz, frango, banana…"
        />
      </label>
      <div className="nutrition-picker-results" role="group" aria-label="Alimentos encontrados">
        {rows.map((food) => (
          <button key={food.id} type="button" onClick={() => onPick(food)}>
            <span>{food.name}</span>
            <small>
              {food.source_id.toUpperCase()} · {food.base_amount} {food.base_unit}
            </small>
          </button>
        ))}
      </div>
    </div>
  );
}

function QuantityForm({
  food,
  onSave,
  onCancel,
  initial,
}: {
  food: Food;
  initial?: { quantity: number; unit: FoodUnit; grams_equivalent: number };
  onSave: (quantity: number, unit: FoodUnit, grams: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 100)),
    [unit, setUnit] = useState<FoodUnit>(initial?.unit ?? 'g'),
    [grams, setGrams] = useState(String(initial?.grams_equivalent ?? 100)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="nutrition-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const q = positiveNumber(quantity),
            g = unit === 'g' ? q : positiveNumber(grams, 'Equivalente em gramas');
          setError('');
          setBusy(true);
          void onSave(q, unit, g).finally(() => setBusy(false));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Quantidade inválida.');
        }
      }}
    >
      <strong>{food.name}</strong>
      <label>
        Quantidade
        <input
          inputMode="decimal"
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            if (unit === 'g') setGrams(e.target.value);
          }}
        />
      </label>
      <label>
        Unidade
        <select value={unit} onChange={(e) => setUnit(e.target.value as FoodUnit)}>
          {foodUnits.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      {unit !== 'g' && (
        <label>
          Equivalente em gramas
          <input
            inputMode="decimal"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            required
          />
        </label>
      )}
      {error && <span role="alert">{error}</span>}
      <div className="nutrition-actions">
        <button className="primary-button" disabled={busy}>
          Salvar
        </button>
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function Nutrition({
  day,
  searchTarget,
  onBodyProgress,
}: {
  day: string;
  searchTarget?: SearchResult;
  onBodyProgress?: () => void;
}) {
  const [repo, setRepo] = useState<NutritionRepository | null>(null),
    [tab, setTab] = useState<Tab>(
      searchTarget?.group === 'Alimentos'
        ? 'foods'
        : searchTarget?.group === 'Refeições'
          ? 'meals'
          : searchTarget?.group === 'Dietas'
            ? 'diet'
            : 'today',
    ),
    [date, setDate] = useState(day),
    [revision, setRevision] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void getDatabase()
      .then((db) => {
        if (alive) setRepo(new NutritionRepository(db));
      })
      .catch(() => {
        if (alive) setError('Não foi possível abrir os dados de alimentação.');
      });
    return () => {
      alive = false;
    };
  }, []);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        setError('');
        await action();
        refresh();
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.');
        return false;
      }
    },
    [refresh],
  );
  return (
    <>
      <header className="page-header">
        <p className="eyebrow">REGISTRAR E ORGANIZAR</p>
        <h1>Alimentação</h1>
        <p>Planeje suas refeições e acompanhe o que consumiu, no seu ritmo.</p>
      </header>
      <nav className="tabs nutrition-tabs" aria-label="Seções de alimentação">
        {tabs.map((item) => (
          <button
            key={item.id}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="nutrition-error">
          {error}
        </p>
      )}
      {!repo ? (
        <p role="status">Carregando alimentação…</p>
      ) : tab === 'today' ? (
        <Today
          repo={repo}
          date={date}
          revision={revision}
          run={run}
          onDiary={() => setTab('diary')}
          onEnergyChange={refresh}
        />
      ) : tab === 'foods' ? (
        <Foods
          repo={repo}
          run={run}
          revision={revision}
          onDiary={() => setTab('diary')}
          initialFoodId={searchTarget?.group === 'Alimentos' ? searchTarget.id : undefined}
        />
      ) : tab === 'meals' ? (
        <Meals repo={repo} run={run} revision={revision} />
      ) : tab === 'diet' ? (
        <Diet repo={repo} run={run} revision={revision} date={date} />
      ) : tab === 'diary' ? (
        <Diary repo={repo} run={run} revision={revision} date={date} setDate={setDate} />
      ) : tab === 'weight' ? (
        <Weight
          repo={repo}
          run={run}
          revision={revision}
          date={date}
          onBodyProgress={onBodyProgress}
        />
      ) : tab === 'shopping' ? (
        <Shopping repo={repo} revision={revision} />
      ) : (
        <History
          repo={repo}
          revision={revision}
          onDate={(next) => {
            setDate(next);
            setTab('diary');
          }}
        />
      )}
    </>
  );
}

function Today({
  repo,
  date,
  revision,
  run,
  onDiary,
  onEnergyChange,
}: {
  repo: NutritionRepository;
  date: string;
  revision: number;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  onDiary: () => void;
  onEnergyChange: () => void;
}) {
  const [values, setValues] = useState<Nutrients>({}),
    [goals, setGoals] = useState<Goals>(),
    [entries, setEntries] = useState<DiaryEntry[]>([]),
    [showGoals, setShowGoals] = useState(false),
    [goalInput, setGoalInput] = useState<Record<keyof Goals, string>>({
      calories: '',
      carbs_g: '',
      protein_g: '',
      fat_g: '',
    });
  useEffect(() => {
    let alive = true;
    void Promise.all([repo.daySummary(date), repo.diary(date)]).then(([[v, g], e]) => {
      if (alive) {
        setValues(v);
        setGoals(g);
        setEntries(e);
      }
    });
    return () => {
      alive = false;
    };
  }, [repo, date, revision]);
  return (
    <section className="nutrition-page">
      <div className="section-heading">
        <h2>Hoje</h2>
        <span>{date}</span>
      </div>
      <NutrientSummary values={values} goals={goals} title="Alimentação de hoje" />
      <EnergyPanel day={date} revision={revision} onChange={onEnergyChange} />
      <div>
        <button
          className="text-button"
          onClick={() => {
            setGoalInput({
              calories: String(goals?.calories ?? ''),
              carbs_g: String(goals?.carbs_g ?? ''),
              protein_g: String(goals?.protein_g ?? ''),
              fat_g: String(goals?.fat_g ?? ''),
            });
            setShowGoals(!showGoals);
          }}
        >
          {showGoals ? 'Fechar metas' : 'Definir metas diárias'}
        </button>
      </div>
      {showGoals && (
        <form
          className="nutrition-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              repo.saveGoals(
                Object.fromEntries(
                  Object.entries(goalInput).map(([k, v]) => [
                    k,
                    v.trim() ? Number(v.replace(',', '.')) : null,
                  ]),
                ) as unknown as Goals,
              ),
            ).then((ok) => {
              if (ok) setShowGoals(false);
            });
          }}
        >
          {(['calories', 'carbs_g', 'protein_g', 'fat_g'] as const).map((key) => (
            <label key={key}>
              {key === 'calories'
                ? 'Calorias (kcal)'
                : key === 'carbs_g'
                  ? 'Carboidratos (g)'
                  : key === 'protein_g'
                    ? 'Proteínas (g)'
                    : 'Gorduras (g)'}
              <input
                inputMode="decimal"
                value={goalInput[key]}
                onChange={(e) => setGoalInput({ ...goalInput, [key]: e.target.value })}
                placeholder="Sem meta"
              />
            </label>
          ))}
          <button className="primary-button">Salvar metas</button>
        </form>
      )}
      <div className="nutrition-section">
        <div className="section-heading">
          <h2>Refeições registradas</h2>
          <button className="text-button" onClick={onDiary}>
            Abrir diário <ChevronRight size={15} />
          </button>
        </div>
        {entries.length ? (
          <div className="nutrition-list">
            {entries.map((entry) => (
              <div key={entry.id}>
                <span>
                  {entry.meal_label} · {entry.food_name}
                </span>
                <strong>{formatAmount(entry.grams_equivalent)} g</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="field-help">
            Nada registrado hoje. O diário está pronto quando você precisar.
          </p>
        )}
      </div>
    </section>
  );
}

function Foods({
  repo,
  run,
  revision,
  onDiary,
  initialFoodId,
}: {
  repo: NutritionRepository;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  revision: number;
  onDiary: () => void;
  initialFoodId?: string;
}) {
  const [query, setQuery] = useState(''),
    [source, setSource] = useState(''),
    [rows, setRows] = useState<Food[]>([]),
    [selected, setSelected] = useState<Food | null>(null),
    [nutrients, setNutrients] = useState<Nutrients>({}),
    [trace, setTrace] = useState<string[]>([]),
    [editing, setEditing] = useState(false),
    [editId, setEditId] = useState<string | undefined>(),
    [name, setName] = useState(''),
    [base, setBase] = useState('100'),
    [baseUnit, setBaseUnit] = useState<FoodUnit>('g'),
    [baseGrams, setBaseGrams] = useState('100'),
    [notes, setNotes] = useState(''),
    [customValues, setCustomValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (initialFoodId) void repo.food(initialFoodId).then(setSelected);
  }, [repo, initialFoodId]);
  useEffect(() => {
    let alive = true;
    void repo.searchFoods(query, source).then((found) => {
      if (alive) setRows(found);
    });
    return () => {
      alive = false;
    };
  }, [repo, query, source, revision]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    void repo.nutrientRows(selected.id).then((found) => {
      if (alive) {
        setNutrients(
          Object.fromEntries(
            found.filter((r) => r.amount !== null).map((r) => [r.nutrient_key, r.amount]),
          ),
        );
        setTrace(
          found
            .filter((r) => r.qualifier === 'trace')
            .map((r) => nutrientInfo[r.nutrient_key]?.[0] ?? r.nutrient_key),
        );
      }
    });
    return () => {
      alive = false;
    };
  }, [repo, selected, revision]);
  return (
    <section className="nutrition-page">
      <div className="section-heading">
        <h2>Alimentos</h2>
        <button
          className="primary-button"
          onClick={() => {
            setEditing(true);
            setEditId(undefined);
            setSelected(null);
            setName('');
            setBase('100');
            setBaseUnit('g');
            setBaseGrams('100');
            setNotes('');
            setCustomValues({});
          }}
        >
          <Plus size={16} /> Novo alimento
        </button>
      </div>
      <div className="nutrition-search">
        <label>
          Buscar alimento
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar na TACO e nos personalizados"
          />
        </label>
        <label>
          Fonte
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Todas</option>
            <option value="taco">TACO</option>
            <option value="custom">Personalizados</option>
          </select>
        </label>
      </div>
      {editing && (
        <form
          className="nutrition-section nutrition-food-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              repo.saveCustomFood(
                {
                  name,
                  base_amount: positiveNumber(base),
                  base_unit: baseUnit,
                  base_grams_equivalent:
                    baseUnit === 'g' ? positiveNumber(base) : positiveNumber(baseGrams),
                  notes,
                  nutrients: Object.fromEntries(
                    Object.entries(customValues)
                      .filter(([, v]) => v.trim())
                      .map(([k, v]) => [k, Number(v.replace(',', '.'))]),
                  ),
                },
                editId,
              ),
            ).then((ok) => {
              if (ok) setEditing(false);
            });
          }}
        >
          <h3>Alimento personalizado</h3>
          <label>
            Nome
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Quantidade base
            <input
              inputMode="decimal"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              required
            />
          </label>
          <label>
            Unidade da base
            <select value={baseUnit} onChange={(e) => setBaseUnit(e.target.value as FoodUnit)}>
              {foodUnits.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {baseUnit !== 'g' && (
            <label>
              Equivalente da base em gramas
              <input
                inputMode="decimal"
                value={baseGrams}
                onChange={(e) => setBaseGrams(e.target.value)}
                required
              />
            </label>
          )}
          <label>
            Observações
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="nutrition-food-grid">
            {(Object.keys(nutrientInfo) as NutrientKey[]).map((key) => (
              <label key={key}>
                {nutrientInfo[key][0]} ({nutrientInfo[key][1]})
                <input
                  inputMode="decimal"
                  value={customValues[key] ?? ''}
                  onChange={(e) => setCustomValues({ ...customValues, [key]: e.target.value })}
                  placeholder="Não informado"
                />
              </label>
            ))}
          </div>
          <div className="nutrition-actions">
            <button className="primary-button">Salvar alimento</button>
            <button type="button" className="secondary-button" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      <div className="nutrition-split">
        <div className="nutrition-list nutrition-food-list">
          {rows.map((food) => (
            <button
              key={food.id}
              onClick={() => {
                setSelected(food);
                setEditing(false);
              }}
              aria-current={selected?.id === food.id ? 'true' : undefined}
            >
              <span>{food.name}</span>
              <small>
                {food.source_id.toUpperCase()} · {food.category}
              </small>
            </button>
          ))}
        </div>
        {selected && (
          <div className="nutrition-section">
            <span className="eyebrow">
              {selected.source_id.toUpperCase()} · base {selected.base_amount} {selected.base_unit}
              {selected.base_unit !== 'g'
                ? ` · ${selected.base_grams_equivalent} g equivalentes`
                : ''}
            </span>
            <h3>{selected.name}</h3>
            <NutrientSummary values={nutrients} />
            {trace.length > 0 && <p className="field-help">Traço na fonte: {trace.join(', ')}.</p>}
            <div className="nutrition-actions">
              <button className="secondary-button" onClick={onDiary}>
                Adicionar ao diário
              </button>
              {selected.is_custom === 1 && (
                <>
                  <button
                    className="text-button"
                    onClick={() => {
                      setEditId(selected.id);
                      setName(selected.name);
                      setBase(String(selected.base_amount));
                      setBaseUnit(selected.base_unit);
                      setBaseGrams(String(selected.base_grams_equivalent));
                      setNotes(selected.notes);
                      setCustomValues(
                        Object.fromEntries(
                          Object.entries(nutrients).map(([k, v]) => [k, String(v)]),
                        ),
                      );
                      setEditing(true);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      void run(() => repo.archiveCustomFood(selected.id)).then((ok) => {
                        if (ok) setSelected(null);
                      })
                    }
                  >
                    Arquivar
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Meals({
  repo,
  run,
  revision,
}: {
  repo: NutritionRepository;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  revision: number;
}) {
  const [rows, setRows] = useState<Meal[]>([]),
    [selected, setSelected] = useState<Meal | null>(null),
    [items, setItems] = useState<MealItem[]>([]),
    [total, setTotal] = useState<Nutrients>({}),
    [name, setName] = useState(''),
    [editingMeal, setEditingMeal] = useState<string>(),
    [picked, setPicked] = useState<Food | null>(null),
    [editingItem, setEditingItem] = useState<MealItem | null>(null);
  useEffect(() => {
    let alive = true;
    void repo.meals().then((found) => {
      if (alive) setRows(found);
    });
    return () => {
      alive = false;
    };
  }, [repo, revision]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    void Promise.all([repo.mealItems(selected.id), repo.mealTotals(selected.id)]).then(
      ([found, values]) => {
        if (alive) {
          setItems(found);
          setTotal(values);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [repo, selected, revision]);
  return (
    <section className="nutrition-page">
      <div className="section-heading">
        <h2>Refeições</h2>
      </div>
      <form
        className="nutrition-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => repo.saveMeal(name, '', editingMeal)).then((ok) => {
            if (ok) {
              setName('');
              setEditingMeal(undefined);
            }
          });
        }}
      >
        <label>
          {editingMeal ? 'Editar refeição' : 'Nova refeição'}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Café da manhã"
            required
          />
        </label>
        <button className="primary-button">
          <Plus size={16} /> {editingMeal ? 'Salvar' : 'Criar'}
        </button>
      </form>
      <div className="nutrition-split">
        <div className="nutrition-list">
          {rows.map((meal) => (
            <button
              key={meal.id}
              onClick={() => {
                setSelected(meal);
                setPicked(null);
              }}
              aria-current={selected?.id === meal.id ? 'true' : undefined}
            >
              <strong>{meal.name}</strong>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
        {selected && (
          <div className="nutrition-section">
            <div className="section-heading">
              <h3>{selected.name}</h3>
              <div className="nutrition-actions">
                <SaveTemplateButton
                  kind="meal"
                  sourceId={selected.id}
                  initialName={selected.name}
                />
                <button
                  className="text-button"
                  onClick={() => {
                    setEditingMeal(selected.id);
                    setName(selected.name);
                  }}
                >
                  Editar
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    void run(() => repo.archiveMeal(selected.id)).then((ok) => {
                      if (ok) setSelected(null);
                    })
                  }
                >
                  Arquivar
                </button>
              </div>
            </div>
            {items.map((item) => (
              <div className="nutrition-item" key={item.id}>
                <span>
                  {item.food_name}
                  <small>{formatAmount(item.grams_equivalent)} g</small>
                </span>
                <div className="nutrition-actions">
                  <button
                    className="text-button"
                    onClick={() =>
                      void repo.food(item.food_id).then((food) => {
                        setPicked(food);
                        setEditingItem(item);
                      })
                    }
                  >
                    Editar
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Remover ${item.food_name}`}
                    onClick={() => void run(() => repo.removeMealItem(item.id))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
            <NutrientSummary values={total} title="Total da refeição" />
            <h4>{editingItem ? 'Editar item' : 'Adicionar alimento'}</h4>
            {picked ? (
              <QuantityForm
                key={editingItem?.id ?? picked.id}
                food={picked}
                initial={editingItem ?? undefined}
                onCancel={() => {
                  setPicked(null);
                  setEditingItem(null);
                }}
                onSave={async (quantity, unit, grams) => {
                  if (
                    await run(() =>
                      repo.saveMealItem(
                        selected.id,
                        { food_id: picked.id, quantity, unit, grams_equivalent: grams },
                        editingItem?.id,
                      ),
                    )
                  ) {
                    setPicked(null);
                    setEditingItem(null);
                  }
                }}
              />
            ) : (
              <FoodPicker
                repo={repo}
                onPick={(food) => {
                  setPicked(food);
                  setEditingItem(null);
                }}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Diet({
  repo,
  run,
  revision,
  date,
}: {
  repo: NutritionRepository;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  revision: number;
  date: string;
}) {
  const [plans, setPlans] = useState<DietPlan[]>([]),
    [selected, setSelected] = useState<DietPlan | null>(null),
    [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [editingPlan, setEditingPlan] = useState<string>(),
    [weekday, setWeekday] = useState(new Date(`${date}T12:00:00`).getDay()),
    [assignments, setAssignments] = useState<DietMeal[]>([]),
    [meals, setMeals] = useState<Meal[]>([]),
    [mealId, setMealId] = useState(''),
    [total, setTotal] = useState<Nutrients>({});
  useEffect(() => {
    let alive = true;
    void Promise.all([repo.plans(), repo.meals()]).then(([p, m]) => {
      if (alive) {
        setPlans(p);
        setMeals(m);
        setSelected(
          (old) => p.find((x) => x.id === old?.id) ?? p.find((x) => x.active === 1) ?? p[0] ?? null,
        );
      }
    });
    return () => {
      alive = false;
    };
  }, [repo, revision]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    void Promise.all([
      repo.planMeals(selected.id, weekday),
      repo.planDayTotals(selected.id, weekday),
    ]).then(([a, t]) => {
      if (alive) {
        setAssignments(a);
        setTotal(t);
      }
    });
    return () => {
      alive = false;
    };
  }, [repo, selected, weekday, revision]);
  return (
    <section className="nutrition-page">
      <div className="section-heading">
        <h2>Dieta semanal</h2>
      </div>
      <form
        className="nutrition-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => repo.savePlan(name, description, editingPlan)).then((ok) => {
            if (ok) {
              setName('');
              setDescription('');
              setEditingPlan(undefined);
            }
          });
        }}
      >
        <label>
          {editingPlan ? 'Editar dieta' : 'Nova dieta'}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dieta atual"
            required
          />
        </label>
        <label>
          Descrição
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <button className="primary-button">
          <Plus size={16} /> {editingPlan ? 'Salvar' : 'Criar'}
        </button>
      </form>
      <div className="nutrition-plan-list">
        {plans.map((plan) => (
          <button
            key={plan.id}
            aria-current={selected?.id === plan.id ? 'true' : undefined}
            onClick={() => setSelected(plan)}
          >
            {plan.name}
            {plan.active === 1 && <span>Ativa</span>}
          </button>
        ))}
      </div>
      {selected && (
        <>
          <div className="nutrition-actions">
            <button
              className="secondary-button"
              disabled={selected.active === 1}
              onClick={() => void run(() => repo.activatePlan(selected.id))}
            >
              Ativar dieta
            </button>
            <button
              className="text-button"
              onClick={() => {
                setEditingPlan(selected.id);
                setName(selected.name);
                setDescription(selected.description);
              }}
            >
              Editar
            </button>
            <button
              className="text-button"
              onClick={() => void run(() => repo.archivePlan(selected.id))}
            >
              Arquivar
            </button>
          </div>
          <div className="nutrition-week" role="group" aria-label="Dia da semana">
            {weekdays.map((label, index) => (
              <button
                key={index}
                aria-pressed={weekday === index}
                onClick={() => setWeekday(index)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="nutrition-split">
            <div className="nutrition-section">
              <h3>{weekdays[weekday]} · Refeições planejadas</h3>
              {assignments.length ? (
                assignments.map((row) => (
                  <div key={row.id} className="nutrition-item">
                    <span>{row.meal_name}</span>
                    <button
                      className="icon-button"
                      aria-label={`Remover ${row.meal_name} da dieta`}
                      onClick={() => void run(() => repo.removePlanMeal(row.id))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="field-help">Nenhuma refeição planejada.</p>
              )}
              <form
                className="nutrition-inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (mealId) void run(() => repo.addPlanMeal(selected.id, weekday, mealId));
                }}
              >
                <label>
                  Adicionar refeição
                  <select value={mealId} onChange={(e) => setMealId(e.target.value)} required>
                    <option value="">Selecione</option>
                    {meals
                      .filter((m) => !assignments.some((a) => a.meal_id === m.id))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="primary-button">Adicionar</button>
              </form>
            </div>
            <NutrientSummary values={total} title={`Totais da dieta para ${weekdays[weekday]}`} />
          </div>
        </>
      )}
    </section>
  );
}

function Diary({
  repo,
  run,
  revision,
  date,
  setDate,
}: {
  repo: NutritionRepository;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  revision: number;
  date: string;
  setDate: (date: string) => void;
}) {
  const [entries, setEntries] = useState<DiaryEntry[]>([]),
    [totals, setTotals] = useState<Nutrients>({}),
    [goals, setGoals] = useState<Goals>(),
    [label, setLabel] = useState('Café da manhã'),
    [picked, setPicked] = useState<Food | null>(null),
    [planned, setPlanned] = useState<DietMeal[]>([]),
    [copyId, setCopyId] = useState(''),
    [editingEntry, setEditingEntry] = useState<DiaryEntry | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([repo.diary(date), repo.daySummary(date), repo.plans()]).then(
      async ([e, [t, g], plans]) => {
        const active = plans.find((p) => p.active === 1),
          meals = active
            ? await repo.planMeals(active.id, new Date(`${date}T12:00:00`).getDay())
            : [];
        if (alive) {
          setEntries(e);
          setTotals(t);
          setGoals(g);
          setPlanned(meals);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [repo, date, revision]);
  return (
    <section className="nutrition-page">
      <div className="section-heading">
        <h2>Diário alimentar</h2>
        <label>
          Data
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <NutrientSummary values={totals} goals={goals} title="Total registrado no dia" />
      <div className="nutrition-split">
        <div className="nutrition-section">
          <h3>O que foi consumido</h3>
          {entries.length ? (
            entries.map((entry) => (
              <div className="nutrition-item" key={entry.id}>
                <span>
                  <b>{entry.meal_label}</b> · {entry.food_name}
                  <small>
                    {formatAmount(entry.quantity)} {entry.unit} ·{' '}
                    {formatAmount(entry.grams_equivalent)} g
                  </small>
                </span>
                <div className="nutrition-actions">
                  <button
                    className="text-button"
                    onClick={() =>
                      void repo.food(entry.food_id).then((food) => {
                        setPicked(food);
                        setEditingEntry(entry);
                        setLabel(entry.meal_label);
                      })
                    }
                  >
                    Editar
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Excluir ${entry.food_name}`}
                    onClick={() => void run(() => repo.removeDiaryEntry(entry.id))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="field-help">Nenhum alimento registrado nesta data.</p>
          )}
          <form
            className="nutrition-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (copyId) void run(() => repo.copyMealToDiary(copyId, date));
            }}
          >
            <label>
              Copiar refeição planejada
              <select value={copyId} onChange={(e) => setCopyId(e.target.value)}>
                <option value="">Selecione</option>
                {planned.map((m) => (
                  <option key={m.id} value={m.meal_id}>
                    {m.meal_name}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary-button" disabled={!copyId}>
              Copiar para o diário
            </button>
          </form>
        </div>
        <div className="nutrition-section">
          <h3>Registrar alimento</h3>
          <label>
            Refeição
            <select value={label} onChange={(e) => setLabel(e.target.value)}>
              {[
                'Café da manhã',
                'Almoço',
                'Lanche',
                'Jantar',
                'Ceia',
                'Pré-treino',
                'Pós-treino',
                'Outros',
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {picked ? (
            <QuantityForm
              key={editingEntry?.id ?? picked.id}
              food={picked}
              initial={editingEntry ?? undefined}
              onCancel={() => {
                setPicked(null);
                setEditingEntry(null);
              }}
              onSave={async (quantity, unit, grams) => {
                if (
                  await run(() =>
                    repo.saveDiaryEntry(
                      date,
                      label,
                      { food_id: picked.id, quantity, unit, grams_equivalent: grams },
                      editingEntry?.id,
                    ),
                  )
                ) {
                  setPicked(null);
                  setEditingEntry(null);
                }
              }}
            />
          ) : (
            <FoodPicker
              repo={repo}
              onPick={(food) => {
                setPicked(food);
                setEditingEntry(null);
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function Weight({
  repo,
  run,
  revision,
  date,
  onBodyProgress,
}: {
  repo: NutritionRepository;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  revision: number;
  date: string;
  onBodyProgress?: () => void;
}) {
  const [rows, setRows] = useState<WeightEntry[]>([]),
    [day, setDay] = useState(date),
    [kg, setKg] = useState(''),
    [notes, setNotes] = useState(''),
    [editingId, setEditingId] = useState<string>();
  useEffect(() => {
    let alive = true;
    void repo.weights().then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [repo, revision]);
  const graph = [...rows].reverse().slice(-30),
    older = rows.filter((row) => row.entry_date >= addDays(localDate(), -30)).at(-1),
    change =
      rows[0] && older && rows[0].entry_date !== older.entry_date
        ? rows[0].weight_kg - older.weight_kg
        : null,
    min = Math.min(...graph.map((x) => x.weight_kg)),
    max = Math.max(...graph.map((x) => x.weight_kg)),
    range = Math.max(max - min, 1),
    points = graph.map((entry, index) => ({
      entry,
      x: 36 + (index * 528) / Math.max(graph.length - 1, 1),
      y: 100 - ((entry.weight_kg - min) / range) * 65,
    }));
  return (
    <section className="nutrition-page">
      <div className="section-heading">
        <div>
          <h2>Progresso</h2>
          <p className="muted">Seu peso também aparece em Treinos → Progresso corporal.</p>
        </div>
        {onBodyProgress && (
          <button className="text-button" onClick={onBodyProgress}>
            Ver progresso corporal completo →
          </button>
        )}
      </div>
      {rows[0] && (
        <div className="nutrition-weight-summary">
          <span>Peso atual</span>
          <strong>{formatAmount(rows[0].weight_kg)} kg</strong>
          <small>{rows[0].entry_date}</small>
          {change != null && (
            <small>
              Últimos 30 dias: {change > 0 ? '+' : ''}
              {formatAmount(change)} kg
            </small>
          )}
        </div>
      )}
      <form
        className="nutrition-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => repo.saveWeight(day, kg, notes, editingId)).then((ok) => {
            if (ok) {
              setKg('');
              setNotes('');
              setEditingId(undefined);
            }
          });
        }}
      >
        <label>
          Data
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
        </label>
        <label>
          Peso (kg)
          <input
            inputMode="decimal"
            value={kg}
            onChange={(e) => setKg(e.target.value)}
            placeholder="72,5"
            required
          />
        </label>
        <label>
          Notas
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button className="primary-button">{editingId ? 'Salvar alteração' : 'Registrar'}</button>
      </form>
      {graph.length > 1 && (
        <div className="nutrition-chart">
          <svg viewBox="0 0 600 150" role="img" aria-label="Evolução do peso">
            <line x1="36" x2="564" y1="116" y2="116" className="nutrition-chart-axis" />
            <polyline points={points.map(({ x, y }) => `${x},${y}`).join(' ')} />
            {points.map(({ entry, x, y }, index) => (
              <g key={entry.id}>
                <circle cx={x} cy={y} r="5">
                  <title>
                    {entry.entry_date}: {formatAmount(entry.weight_kg)} kg
                  </title>
                </circle>
                {(index === 0 || index === points.length - 1) && (
                  <>
                    <text x={x} y={y - 13} textAnchor="middle">
                      {formatAmount(entry.weight_kg)} kg
                    </text>
                    <text x={x} y="139" textAnchor="middle">
                      {entry.entry_date.slice(5)}
                    </text>
                  </>
                )}
              </g>
            ))}
          </svg>
        </div>
      )}
      <div className="nutrition-list">
        {rows.map((row) => (
          <div key={row.id}>
            <span>
              {row.entry_date} · {row.notes}
            </span>
            <strong>{formatAmount(row.weight_kg)} kg</strong>
            <div className="nutrition-actions">
              <button
                className="text-button"
                onClick={() => {
                  setEditingId(row.id);
                  setDay(row.entry_date);
                  setKg(String(row.weight_kg));
                  setNotes(row.notes);
                }}
              >
                Editar
              </button>
              <button
                className="icon-button"
                aria-label={`Excluir peso de ${row.entry_date}`}
                onClick={() => void run(() => repo.removeWeight(row.id))}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function History({
  repo,
  revision,
  onDate,
}: {
  repo: NutritionRepository;
  revision: number;
  onDate: (day: string) => void;
}) {
  const [rows, setRows] = useState<{ entry_date: string; calories: number; protein: number }[]>([]);
  useEffect(() => {
    let alive = true;
    const to = localDate(),
      from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    void repo.diaryHistory(from, to).then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [repo, revision]);
  return (
    <section className="nutrition-page">
      <div className="section-heading">
        <h2>Histórico alimentar</h2>
        <span>Últimos 90 dias</span>
      </div>
      {rows.length ? (
        <div className="nutrition-list">
          {rows.map((row) => (
            <button key={row.entry_date} onClick={() => onDate(row.entry_date)}>
              <span>{row.entry_date}</span>
              <span>
                {formatAmount(row.calories, 0)} kcal · {formatAmount(row.protein)} g de proteína
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      ) : (
        <p className="field-help">Ainda não há dias registrados.</p>
      )}
    </section>
  );
}

function Shopping({ repo, revision }: { repo: NutritionRepository; revision: number }) {
  const [plan, setPlan] = useState<DietPlan | null>(null),
    [rows, setRows] = useState<{ food_id: string; name: string; grams: number }[]>([]);
  useEffect(() => {
    let alive = true;
    void repo.plans().then(async (plans) => {
      const active = plans.find((p) => p.active === 1) ?? null;
      const items = active ? await repo.shoppingForPlan(active.id) : [];
      if (alive) {
        setPlan(active);
        setRows(items);
      }
    });
    return () => {
      alive = false;
    };
  }, [repo, revision]);
  return (
    <section className="nutrition-page">
      <div className="section-heading">
        <h2>Lista de compras</h2>
        <span>{plan?.name ?? 'Sem dieta ativa'}</span>
      </div>
      <p className="field-help">
        Estimativa para os sete dias planejados. As quantidades usam a gramagem informada nas
        refeições.
      </p>
      {rows.length ? (
        <div className="nutrition-list">
          {rows.map((row) => (
            <div key={row.food_id}>
              <span>{row.name}</span>
              <strong>{formatAmount(row.grams, 0)} g</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="field-help">Adicione refeições à dieta ativa para gerar a lista.</p>
      )}
    </section>
  );
}
