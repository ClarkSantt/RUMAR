import { useEffect, useState } from 'react';
import { getDatabase } from '../../../lib/database/connection';
import { addDays, formatDate, localDate } from '../../../lib/dates';
import { exerciseMetrics, loadLabels } from '../domain';
import type { LoadType } from '../types';
import { WorkoutHistoryRepository, type HistorySet } from '../repositories/history';
import './evolution.css';
const number = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
export function Evolution({ exerciseId }: { exerciseId?: string }) {
  const [selected, setSelected] = useState(exerciseId ?? ''),
    [exercises, setExercises] = useState<
      { id: string; name: string; archived_at: string | null }[]
    >([]),
    [loadType, setLoadType] = useState<LoadType>('total'),
    [period, setPeriod] = useState(90),
    [rows, setRows] = useState<HistorySet[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then((db) => new WorkoutHistoryRepository(db).exerciseOptions())
      .then((data) => {
        if (active) setExercises(data);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!selected) return;
    void (async () => {
      setLoading(true);
      setError('');
      try {
        const db = await getDatabase(),
          to = localDate();
        const data = await new WorkoutHistoryRepository(db).exercise(selected, {
          from: addDays(to, 1 - period),
          to,
        });
        if (active) {
          setRows(data);
          setLoadType((current) =>
            data.some((row) => row.load_type === current)
              ? current
              : (data[0]?.load_type ?? current),
          );
        }
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selected, period]);
  const metrics = exerciseMetrics(rows, selected, loadType),
    unit = loadLabels[loadType],
    volumeAvailable = !['bodyweight', 'none'].includes(loadType);
  const available = [...new Set(rows.map((r) => r.load_type))];
  return (
    <section className="workout-evolution" aria-label="Evolução de exercícios">
      <div className="evolution-filters">
        <label>
          Exercício
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setRows([]);
            }}
          >
            <option value="">Selecione um exercício</option>
            {exercises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.archived_at ? ' (arquivado)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Período
          <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
            <option value={365}>Últimos 12 meses</option>
          </select>
        </label>
        <label>
          Tipo de carga
          <select value={loadType} onChange={(e) => setLoadType(e.target.value as LoadType)}>
            {(Object.keys(loadLabels) as LoadType[]).map((type) => (
              <option key={type} value={type}>
                {loadLabels[type]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {!selected ? (
        <p className="muted">Selecione um exercício para visualizar a evolução.</p>
      ) : loading ? (
        <p role="status">Carregando evolução…</p>
      ) : (
        <>
          {!metrics.sessions.length ? (
            <p className="muted">
              Nenhuma série concluída neste período e tipo de carga.
              {available.length > 0
                ? ` Tipos registrados: ${available.map((t) => loadLabels[t]).join(', ')}.`
                : ''}
            </p>
          ) : (
            <>
              <div className="evolution-records">
                <div>
                  <span>{loadType === 'bodyweight' ? 'Maior carga adicional' : 'Maior carga'}</span>
                  <strong>
                    {metrics.maxLoad === null
                      ? 'Não se aplica'
                      : `${number(metrics.maxLoad)} ${unit}`}
                  </strong>
                </div>
                <div>
                  <span>Maior volume por sessão do exercício</span>
                  <strong>
                    {metrics.maxSessionVolume === null
                      ? 'Não se aplica'
                      : `${number(metrics.maxSessionVolume)} ${unit} × reps`}
                  </strong>
                </div>
              </div>
              <h3>Melhores repetições por carga</h3>
              <div className="evolution-reps">
                {[...metrics.repsByLoad.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map(([load, reps]) => (
                    <span key={load}>
                      {loadType === 'none' ? 'Sem carga' : `${number(load)} ${unit}`} × {reps}
                    </span>
                  ))}
              </div>
              <h3>
                {loadType === 'none'
                  ? 'Repetições por sessão'
                  : loadType === 'bodyweight'
                    ? 'Carga adicional por sessão'
                    : 'Carga máxima por sessão'}
              </h3>
              <EvolutionChart
                points={metrics.sessions.map((s) => ({
                  id: s.id,
                  date: s.date,
                  value: loadType === 'none' ? s.maxReps : (s.maxLoad ?? 0),
                }))}
                unit={loadType === 'none' ? 'reps' : unit}
              />
              <div className="evolution-table-wrap">
                <table className="evolution-table">
                  <caption>Dados do gráfico e volume registrado por sessão</caption>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Séries</th>
                      <th>Reps totais</th>
                      <th>{loadType === 'none' ? 'Máximo de reps' : 'Maior carga'}</th>
                      <th>Volume registrado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.sessions.map((s) => (
                      <tr key={s.id}>
                        <td>{formatDate(s.date)}</td>
                        <td>{s.sets}</td>
                        <td>{s.reps}</td>
                        <td>
                          {loadType === 'none' ? s.maxReps : `${number(s.maxLoad ?? 0)} ${unit}`}
                        </td>
                        <td>{s.volume === null ? 'Não se aplica' : number(s.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="evolution-method">
            Somente séries concluídas de sessões finalizadas. Aquecimento não entra nas marcas nem
            no volume principal.{' '}
            {volumeAvailable
              ? 'Volume registrado = carga informada × repetições, sem dobrar cargas por lado ou por halter.'
              : 'Peso corporal e exercícios sem carga não recebem volume de carga total.'}{' '}
            Os tipos de carga são comparados separadamente. Marcas apresentadas correspondem ao
            período selecionado.
          </p>
        </>
      )}
    </section>
  );
}
function EvolutionChart({
  points,
  unit,
}: {
  points: { id: string; date: string; value: number }[];
  unit: string;
}) {
  const width = 640,
    height = 200,
    max = Math.max(1, ...points.map((p) => p.value)),
    x = (i: number) => 48 + (points.length === 1 ? 264 : (i * 528) / (points.length - 1)),
    y = (value: number) => 160 - (value / max) * 130;
  return (
    <svg
      className="evolution-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Evolução em ${unit}. Os mesmos valores estão na tabela abaixo.`}
    >
      <line x1="48" y1="160" x2="576" y2="160" />
      <line x1="48" y1="30" x2="48" y2="160" />
      <text x="42" y="34" textAnchor="end">
        {number(max)}
      </text>
      <text x="42" y="164" textAnchor="end">
        0
      </text>
      <polyline
        points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')}
        fill="none"
        className="evolution-line"
      />
      {points.map((p, i) => (
        <circle key={p.id} cx={x(i)} cy={y(p.value)} r="4">
          <title>
            {formatDate(p.date)}: {number(p.value)} {unit}
          </title>
        </circle>
      ))}
      <text x="48" y="190">
        {formatDate(points[0].date)}
      </text>
      <text x="576" y="190" textAnchor="end">
        {formatDate(points[points.length - 1].date)}
      </text>
    </svg>
  );
}
