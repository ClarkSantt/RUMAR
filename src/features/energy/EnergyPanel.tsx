import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { addDays, localDate, parseDate } from '../../lib/dates';
import { EnergyRepository, type EnergyDay } from './repository';
import { desiredBalance, type EnergyProfile } from './domain';
import './energy.css';
const number = (n: number | null) => (n === null ? '—' : Math.round(n).toLocaleString('pt-BR'));
export function EnergyPanel({
  day = localDate(),
  revision,
  onChange,
  activity = false,
}: {
  day?: string;
  revision?: unknown;
  onChange?: () => void;
  activity?: boolean;
}) {
  const [profile, setProfile] = useState<EnergyProfile | null>(null),
    [rows, setRows] = useState<EnergyDay[]>([]),
    [averages, setAverages] = useState<{ days: number; average: number | null; period: number }[]>(
      [],
    ),
    [steps, setSteps] = useState(''),
    [workoutSteps, setWorkoutSteps] = useState('0'),
    [activityDay, setActivityDay] = useState(day),
    [notes, setNotes] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const monday = addDays(day, -((parseDate(day).getDay() + 6) % 7));
  useEffect(() => {
    let alive = true;
    void getDatabase()
      .then(async (db) => {
        const r = new EnergyRepository(db);
        return Promise.all([r.profile(), r.range(monday, addDays(monday, 6)), r.averages(day)]);
      })
      .then(([p, data, avg]) => {
        if (alive) {
          setProfile(p);
          setRows(data);
          setAverages(avg);
        }
      })
      .catch(() => {
        if (alive) setError('Não foi possível carregar energia e atividade.');
      });
    return () => {
      alive = false;
    };
  }, [day, monday, refresh, revision]);
  useEffect(() => {
    if (!activity) return;
    let alive = true;
    void getDatabase()
      .then((db) => new EnergyRepository(db).activityEntry(activityDay))
      .then((entry) => {
        if (alive) {
          setSteps(entry === null ? '' : String(entry.steps));
          setWorkoutSteps(String(entry?.workout_steps ?? 0));
          setNotes(entry?.notes ?? '');
        }
      })
      .catch(() => {
        if (alive) setError('Não foi possível carregar os passos desta data.');
      });
    return () => {
      alive = false;
    };
  }, [activity, activityDay, refresh]);
  const current = rows.find((r) => r.day === day),
    known = rows.filter((r) => r.day <= day && r.balance !== null),
    balance = known.reduce((sum, r) => sum + r.balance!, 0);
  async function run(fn: (repo: EnergyRepository) => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn(new EnergyRepository(await getDatabase()));
      setRefresh((n) => n + 1);
      onChange?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="energy-panel secondary-section" aria-label="Energia e atividade">
      <div className="section-heading">
        <h2>{activity ? 'Atividade diária' : 'Gasto e meta estimados'}</h2>
      </div>
      {error && <p role="alert">{error}</p>}
      {activity && (
        <form
          className="energy-activity"
          onSubmit={(e) => {
            e.preventDefault();
            void run((r) =>
              r.activity(
                activityDay,
                steps.trim() ? Number(steps) : NaN,
                notes,
                workoutSteps.trim() ? Number(workoutSteps) : NaN,
              ),
            );
          }}
        >
          <label>
            Passos de hoje
            <input
              type="number"
              required
              min="0"
              max="200000"
              step="1"
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
            />
          </label>
          <button className="primary-button" disabled={busy}>
            Salvar passos
          </button>
          <details>
            <summary>Outro dia e detalhes (opcional)</summary>
            <label>
              Data
              <input
                type="date"
                required
                value={activityDay}
                onChange={(e) => setActivityDay(e.target.value)}
              />
            </label>
            <label>
              Passos do treino incluídos no total
              <input
                type="number"
                required
                min="0"
                max={steps || '200000'}
                step="1"
                value={workoutSteps}
                onChange={(e) => setWorkoutSteps(e.target.value)}
              />
            </label>
            <label>
              Observação
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </details>
        </form>
      )}
      {activity && (
        <p className="field-help">
          Hoje: {number(current?.steps ?? null)} passos ·{' '}
          {averages
            .map((a) => `Média ${a.period} dias: ${number(a.average)} (${a.days} dias registrados)`)
            .join(' · ')}{' '}
          · Dias sem registro não contam como zero.
        </p>
      )}
      {!profile ? (
        <p className="field-help">
          Informe seus dados em Configurações → Perfil para ativar as estimativas. As metas manuais
          de alimentação continuam disponíveis.
        </p>
      ) : !current?.weight ? (
        <p className="field-help">
          Informe o peso em Configurações → Perfil ou Progresso corporal para calcular as
          estimativas.
        </p>
      ) : (
        <>
          <p>
            Gasto estimado hoje: <strong>{number(current.expenditure)} kcal</strong> · Meta
            estimada: <strong>{number(current.target)} kcal</strong> · Consumido registrado:{' '}
            <strong>{number(current.consumed)} kcal</strong> · Restante:{' '}
            <strong>
              {number(
                current.target === null || current.consumed === null
                  ? null
                  : current.target - current.consumed,
              )}{' '}
              kcal
            </strong>
          </p>
          <p className="field-help">
            Objetivo:{' '}
            {
              {
                lose: 'Perder peso',
                maintain: 'Manter peso',
                gain: 'Ganhar peso',
                custom: 'Personalizado',
              }[profile.objective]
            }{' '}
            · Balanço desejado: {number(desiredBalance(profile) * 7)} kcal/semana ·{' '}
            {current.balance === null
              ? 'Sem consumo registrado'
              : current.balance < 0
                ? 'Déficit estimado'
                : 'Superávit estimado'}
            : {number(current.balance)} kcal
          </p>
          <details>
            <summary>Como foi calculado?</summary>
            <dl className="energy-values">
              {[
                ['TMB estimada', current.resting],
                [
                  'Atividade cotidiana',
                  current.resting === null || current.base === null
                    ? null
                    : current.base - current.resting,
                ],
                ['Ajuste de passos', current.step_adjustment],
                ['Treino planejado', current.planned_workout],
                ['Treino concluído', current.completed_workout],
                ['Gasto diário estimado', current.expenditure],
                ['Meta planejada', current.planned_target],
                ['Meta atualizada', current.target],
                ['Consumido registrado', current.consumed],
                [
                  'Restante',
                  current.target === null || current.consumed === null
                    ? null
                    : current.target - current.consumed,
                ],
                ['Balanço estimado', current.balance],
              ].map(([label, v]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{number(v as number | null)} kcal</dd>
                </div>
              ))}
            </dl>
            <p className="field-help">
              {current.steps === null
                ? `Passos estimados: ${number(current.estimated_steps)} (histórico recente ou referência inicial)`
                : 'Atualizado com passos registrados'}{' '}
              · Rotina cotidiana exclui treino estruturado. Treino planejado não conta como
              concluído.
              {current.step_adjustment_withheld
                ? ' Ajuste de passos omitido para evitar sobreposição com treino; informe os passos do treino nos detalhes de Atividade para calcular a diferença.'
                : ''}
            </p>
          </details>
          {current.goals &&
            (current.goals.protein_g > 0 ||
              current.goals.carbs_g > 0 ||
              current.goals.fat_g > 0) && (
              <p className="field-help">
                Macros configurados: proteína {number(current.goals.protein_g)} g · carboidratos{' '}
                {number(current.goals.carbs_g)} g · gordura {number(current.goals.fat_g)} g ·
                energia dos macros {number(current.goals.macro_calories)} kcal.
                {current.goals.insufficient
                  ? ' Proteína e gordura configuradas excedem a meta; carboidratos restantes limitados a zero.'
                  : ''}
              </p>
            )}
          <details>
            <summary>Balanço da semana</summary>
            <p className="field-help">
              Estimativas recalculadas com o perfil atual; não representam perda de gordura nem
              causalidade exata com peso.
            </p>
            <ul className="energy-week">
              {rows.map((r) => (
                <li key={r.day}>
                  {parseDate(r.day).toLocaleDateString('pt-BR', { weekday: 'short' })} ·{' '}
                  {r.day > day
                    ? 'Planejado'
                    : r.balance === null
                      ? 'Sem registro alimentar'
                      : `${number(r.balance)} kcal · ${r.steps === null ? 'Estimado' : 'Atualizado'}`}
                </li>
              ))}
            </ul>
            <p>
              Acumulado: {number(balance)} kcal · Média:{' '}
              {known.length ? number(balance / known.length) : '—'} kcal/dia · Meta semanal:{' '}
              {number(desiredBalance(profile) * 7)} kcal
            </p>
            <p className="field-help">
              Dias com ingestão registrada: {known.length}/7. Dias futuros ou sem ingestão não
              entram na soma.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
