import { useEffect, useMemo, useRef, useState } from 'react';
import { EnergyPanel } from '../energy/EnergyPanel';
import { Activity, Plus, Trash2 } from 'lucide-react';
import { getDatabase } from '../../lib/database/connection';
import { addDays, formatDate, localDate } from '../../lib/dates';
import { comparison, formatMeasurement, metrics, type BodyRecord, type MetricKey } from './domain';
import { BodyProgressRepository } from './repository';
import './body-progress.css';

const formatNumber = (value: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
const signed = (value: number, unit: string) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value))} ${unit}`;
type HistoryPoint = { date: string; value: number };
function MetricChart({
  points,
  label,
  unit,
}: {
  points: HistoryPoint[];
  label: string;
  unit: string;
}) {
  const chronological = [...points].reverse();
  if (chronological.length < 2)
    return <p className="muted">Registre outra data para ver a evolução.</p>;
  const values = chronological.map((point) => point.value);
  const min = Math.min(...values),
    max = Math.max(...values),
    range = Math.max(max - min, 1);
  const plotted = chronological.map((point, index) => ({
    ...point,
    x: 36 + (index * 528) / Math.max(chronological.length - 1, 1),
    y: 110 - ((point.value - min) / range) * 70,
  }));
  return (
    <div className="body-chart">
      <svg viewBox="0 0 600 150" role="img" aria-label={`Evolução de ${label}`}>
        <line x1="36" x2="564" y1="122" y2="122" className="body-chart-axis" />
        <polyline points={plotted.map(({ x, y }) => `${x},${y}`).join(' ')} />
        {plotted.map((point, index) => (
          <g key={point.date}>
            <circle cx={point.x} cy={point.y} r="4">
              <title>{`${formatDate(point.date)}: ${formatMeasurement(point.value, unit)}`}</title>
            </circle>
            {(index === 0 || index === plotted.length - 1) && (
              <text x={point.x} y="143" textAnchor="middle">
                {formatDate(point.date)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <table className="body-history-table">
        <caption>Histórico de {label.toLowerCase()}</caption>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Valor</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <td>{formatDate(point.date)}</td>
              <td>{formatMeasurement(point.value, unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BodyProgress() {
  const editorRef = useRef<HTMLDivElement>(null);
  const [repo, setRepo] = useState<BodyProgressRepository>();
  const [records, setRecords] = useState<BodyRecord[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [metric, setMetric] = useState<MetricKey>('weight');
  const [day, setDay] = useState(localDate());
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Partial<Record<MetricKey, string>>>({});
  const [notes, setNotes] = useState('');
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) return;
    editorRef.current?.scrollIntoView({ block: 'start' });
    editorRef.current?.querySelector<HTMLInputElement>('input[type="date"]')?.focus();
  }, [editing]);
  useEffect(() => {
    let live = true;
    void getDatabase()
      .then((db) => {
        if (live) setRepo(new BodyProgressRepository(db));
      })
      .catch(() => {
        if (live) setError('Não foi possível abrir o progresso corporal.');
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!repo) return;
    let live = true;
    void Promise.all([repo.records(200), repo.history(metric, 100)])
      .then(([next, points]) => {
        if (live) {
          setRecords(next);
          setHistory(points);
          setCompareA((value) => value || next[1]?.date || next[0]?.date || '');
          setCompareB((value) => value || next[0]?.date || '');
        }
      })
      .catch(() => {
        if (live) setError('Não foi possível carregar as medidas.');
      });
    return () => {
      live = false;
    };
  }, [repo, metric, revision]);
  function edit(record?: BodyRecord) {
    setDay(record?.date ?? localDate());
    setValues(
      Object.fromEntries(
        Object.entries(record?.values ?? {}).map(([key, value]) => [key, String(value)]),
      ),
    );
    setNotes(record?.notes ?? '');
    setEditing(true);
    setError('');
  }
  function changeDay(next: string) {
    setDay(next);
    const existing = records.find((record) => record.date === next);
    setValues(
      Object.fromEntries(
        Object.entries(existing?.values ?? {}).map(([key, value]) => [key, String(value)]),
      ),
    );
    setNotes(existing?.notes ?? '');
  }
  async function save() {
    if (!repo || busy) return;
    setBusy(true);
    setError('');
    try {
      const knownRecord = records.some((record) => record.date === day);
      const changes = Object.fromEntries(
        metrics
          .filter(([key]) => knownRecord || values[key]?.trim())
          .map(([key]) => [key, values[key]?.trim() || null]),
      );
      if (!Object.values(changes).some(Boolean) && !notes.trim())
        throw Error('Informe ao menos uma medida ou observação.');
      await repo.save(day, changes, notes);
      setEditing(false);
      setRevision((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a medição.');
    } finally {
      setBusy(false);
    }
  }
  async function remove(date: string) {
    if (!repo || !window.confirm(`Excluir a medição de ${formatDate(date)}?`)) return;
    try {
      await repo.remove(date);
      setRevision((current) => current + 1);
    } catch {
      setError('Não foi possível excluir a medição.');
    }
  }
  const latest = useMemo(() => repo?.latestValues(records) ?? {}, [repo, records]);
  const weight = records.find((record) => record.values.weight != null);
  const olderWeight = records
    .filter((record) => record.date >= addDays(localDate(), -30) && record.values.weight != null)
    .at(-1);
  const delta =
    weight?.values.weight != null &&
    olderWeight?.values.weight != null &&
    weight.date !== olderWeight.date
      ? weight.values.weight - olderWeight.values.weight
      : null;
  const selectedMetric = metrics.find(([key]) => key === metric)!;
  const a = records.find((record) => record.date === compareA);
  const b = records.find((record) => record.date === compareB);
  const differences = comparison(a, b);
  return (
    <section className="body-progress" aria-label="Progresso corporal">
      <div className="workout-section-heading">
        <div>
          <h2>Progresso corporal</h2>
          <p>Peso e medidas em um só lugar, sem interpretar suas mudanças.</p>
        </div>
        <button className="primary-button" onClick={() => edit()}>
          <Plus size={16} /> Nova medição
        </button>
      </div>
      <EnergyPanel activity revision={revision} />
      {error && <p role="alert">{error}</p>}
      {!records.length ? (
        <div className="body-empty">
          <Activity size={24} />
          <h3>Nenhuma medição ainda.</h3>
          <p>Registre peso, medidas ou ambos quando fizer sentido para você.</p>
        </div>
      ) : (
        <>
          <div className="body-overview">
            {weight?.values.weight != null && (
              <div>
                <span>Peso atual</span>
                <strong>{formatMeasurement(weight.values.weight, 'kg')}</strong>
                <small>{formatDate(weight.date)}</small>
              </div>
            )}
            {delta != null && (
              <div>
                <span>Últimos 30 dias</span>
                <strong>{signed(delta, 'kg')}</strong>
                <small>Variação descritiva</small>
              </div>
            )}
            {latest.body_fat != null && (
              <div>
                <span>Gordura corporal</span>
                <strong>{formatMeasurement(latest.body_fat, '%')}</strong>
              </div>
            )}
            <div>
              <span>Última medição</span>
              <strong>{formatDate(records[0].date)}</strong>
            </div>
          </div>
          <section className="body-section">
            <div className="section-heading">
              <h3>Evolução</h3>
              <label>
                Métrica{' '}
                <select
                  value={metric}
                  onChange={(event) => setMetric(event.target.value as MetricKey)}
                >
                  {metrics.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <MetricChart points={history} label={selectedMetric[1]} unit={selectedMetric[2]} />
          </section>
          <section className="body-section">
            <h3>Medidas</h3>
            <div className="body-metric-grid">
              {metrics
                .filter(([key]) => key !== 'weight' && latest[key] != null)
                .map(([key, label, unit]) => {
                  const measurements = records
                    .filter((record) => record.values[key] != null)
                    .slice(0, 2);
                  const change =
                    measurements.length === 2
                      ? measurements[0].values[key]! - measurements[1].values[key]!
                      : null;
                  return (
                    <div key={key}>
                      <span>{label}</span>
                      <strong>{formatMeasurement(latest[key]!, unit)}</strong>
                      {change != null && (
                        <small>{signed(change, unit)} desde a medição anterior</small>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
          <section className="body-section">
            <h3>Comparar datas</h3>
            <div className="body-compare-controls">
              <label>
                Data A
                <select value={compareA} onChange={(event) => setCompareA(event.target.value)}>
                  {records.map((record) => (
                    <option key={record.date} value={record.date}>
                      {formatDate(record.date)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Data B
                <select value={compareB} onChange={(event) => setCompareB(event.target.value)}>
                  {records.map((record) => (
                    <option key={record.date} value={record.date}>
                      {formatDate(record.date)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="body-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Medida</th>
                    <th scope="col">{a ? formatDate(a.date) : 'Data A'}</th>
                    <th scope="col">{b ? formatDate(b.date) : 'Data B'}</th>
                    <th scope="col">Variação</th>
                  </tr>
                </thead>
                <tbody>
                  {differences.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.label}</th>
                      <td>{row.a == null ? '—' : formatMeasurement(row.a, row.unit)}</td>
                      <td>{row.b == null ? '—' : formatMeasurement(row.b, row.unit)}</td>
                      <td>{row.change == null ? '—' : signed(row.change, row.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="body-section">
            <h3>Registros</h3>
            <div className="body-records">
              {records.map((record) => (
                <div key={record.date}>
                  <span>
                    <strong>{formatDate(record.date)}</strong>
                    <small>
                      {Object.keys(record.values).length} medidas
                      {record.notes ? ` · ${record.notes}` : ''}
                    </small>
                  </span>
                  <button className="text-button" onClick={() => edit(record)}>
                    Editar
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Excluir medição de ${formatDate(record.date)}`}
                    onClick={() => void remove(record.date)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      {editing && (
        <div className="body-editor" ref={editorRef}>
          <div className="section-heading">
            <h3>
              {records.some((record) => record.date === day) ? 'Editar medição' : 'Nova medição'}
            </h3>
            <button className="text-button" onClick={() => setEditing(false)}>
              Fechar
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label>
              Data
              <input
                type="date"
                required
                value={day}
                onChange={(event) => changeDay(event.target.value)}
              />
            </label>
            <div className="body-input-grid">
              {metrics.map(([key, label, unit]) => (
                <label key={key}>
                  {label} ({unit})
                  <input
                    inputMode="decimal"
                    value={values[key] ?? ''}
                    placeholder={key === 'weight' ? '91,4' : ''}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              Observações
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
            </label>
            <button className="primary-button" disabled={busy}>
              Salvar medição
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
