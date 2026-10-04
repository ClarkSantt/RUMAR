import { useEffect, useMemo, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { fileHash } from '../finance/ofx';
import {
  parseCsv,
  parseIcs,
  probableFinanceDuplicates,
  validateBodyCsv,
  validateFinanceCsv,
  type FinanceColumns,
  type BodyImportRow,
  type CalendarImportRow,
  type FinanceImportRow,
} from './import';

type Kind = 'finance_csv' | 'body_csv' | 'calendar_ics';
type Account = { id: string; name: string };
type Category = { id: string; name: string; kind: 'income' | 'expense' };
type ImportBatch = {
  id: string;
  kind: Kind;
  file_name: string;
  row_count: number;
  imported_at: string;
};
const headersFor = (rows: string[][]) => rows[0] ?? [];
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const metricLabels: Record<string, string> = {
  weight: 'Peso (kg)',
  body_fat: 'Gordura (%)',
  waist: 'Cintura (cm)',
  chest: 'Peito (cm)',
  left_arm: 'Braço esquerdo (cm)',
  right_arm: 'Braço direito (cm)',
  neck: 'Pescoço (cm)',
  hips: 'Quadril (cm)',
};
function guess(headers: string[], names: string[]): number {
  const normalized = headers.map((value) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase(),
  );
  return normalized.findIndex((value) => names.some((name) => value === name));
}

export function ImportData({ onImported }: { onImported: () => Promise<void> }) {
  const [kind, setKind] = useState<Kind>('finance_csv');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [columns, setColumns] = useState<FinanceColumns>({ date: -1, description: -1, amount: -1 });
  const [defaultType, setDefaultType] = useState<'expense' | 'income'>('expense');
  const [conflictPolicy, setConflictPolicy] = useState<'update' | 'skip'>('skip');
  const [conflicts, setConflicts] = useState(0);
  const [probableDuplicates, setProbableDuplicates] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [account, setAccount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [importValidOnly, setImportValidOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  async function loadHistory() {
    const db = await getDatabase();
    setHistory(
      await db.select<ImportBatch[]>(
        'SELECT id,kind,file_name,row_count,imported_at FROM data_import_batches ORDER BY imported_at DESC,id DESC LIMIT 20',
      ),
    );
  }
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then(async (db) => {
        const [foundAccounts, foundCategories] = await Promise.all([
          db.select<Account[]>(
            'SELECT id,name FROM finance_accounts WHERE archived_at IS NULL ORDER BY name',
          ),
          db.select<Category[]>(
            'SELECT id,name,kind FROM finance_categories WHERE archived_at IS NULL ORDER BY kind,name',
          ),
        ]);
        return { foundAccounts, foundCategories };
      })
      .then(({ foundAccounts, foundCategories }) => {
        if (active) {
          setAccounts(foundAccounts);
          setCategories(foundCategories);
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar as contas.');
      });
    void getDatabase()
      .then((db) =>
        db.select<ImportBatch[]>(
          'SELECT id,kind,file_name,row_count,imported_at FROM data_import_batches ORDER BY imported_at DESC,id DESC LIMIT 20',
        ),
      )
      .then((found) => {
        if (active) setHistory(found);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar o histórico de importações.');
      });
    return () => {
      active = false;
    };
  }, []);
  const prepared = useMemo(() => {
    if (!file) return { values: [] as unknown[], issues: [] as string[], error: '' };
    try {
      if (kind === 'finance_csv')
        return {
          ...validateFinanceCsv(rows, columns, defaultType, accounts, categories),
          error: '',
        };
      if (kind === 'body_csv') return { ...validateBodyCsv(rows), error: '' };
      return { values: parseIcs(text), issues: [] as string[], error: '' };
    } catch (cause) {
      return { values: [] as unknown[], issues: [] as string[], error: String(cause) };
    }
  }, [file, kind, rows, columns, defaultType, text, accounts, categories]);
  useEffect(() => {
    let active = true;
    if (prepared.error || !prepared.values.length || kind === 'finance_csv') return;
    void getDatabase()
      .then(async (db) => {
        if (kind === 'body_csv') {
          const values = prepared.values as BodyImportRow[];
          const dates = values.map((value) => value.date).sort();
          const existing = await db.select<{ measurement_date: string }[]>(
            'SELECT measurement_date FROM body_measurement_records WHERE measurement_date BETWEEN $1 AND $2',
            [dates[0], dates[dates.length - 1]],
          );
          const found = new Set(existing.map((value) => value.measurement_date));
          return values.filter((value) => found.has(value.date)).length;
        }
        const existing = await db.select<{ uid: string }[]>(
          'SELECT uid FROM external_calendar_events',
        );
        const found = new Set(existing.map((value) => value.uid));
        return (prepared.values as CalendarImportRow[]).filter((value) => found.has(value.uid))
          .length;
      })
      .then((count) => {
        if (active) setConflicts(count);
      })
      .catch(() => {
        if (active) setError('Não foi possível verificar conflitos existentes.');
      });
    return () => {
      active = false;
    };
  }, [kind, prepared.error, prepared.values]);
  useEffect(() => {
    let active = true;
    if (kind !== 'finance_csv' || !account || prepared.error || !prepared.values.length) return;
    const values = prepared.values as FinanceImportRow[];
    const dates = values.map((value) => value.date).sort();
    void getDatabase()
      .then((db) =>
        db.select<
          {
            date: string;
            amount_cents: number;
            normalized_description: string;
            account_id: string;
          }[]
        >(
          'SELECT date,amount_cents,normalized_description,account_id FROM finance_transactions WHERE date BETWEEN $1 AND $2',
          [dates[0], dates[dates.length - 1]],
        ),
      )
      .then((existing) => {
        if (active) setProbableDuplicates(probableFinanceDuplicates(values, existing, account));
      })
      .catch(() => {
        if (active) setError('Não foi possível conferir possíveis duplicatas.');
      });
    return () => {
      active = false;
    };
  }, [kind, account, prepared.error, prepared.values]);
  async function choose(selected: File | null) {
    setFile(null);
    setRows([]);
    setText('');
    setError('');
    setResult('');
    setConfirmed(false);
    setImportValidOnly(false);
    setConflicts(0);
    setProbableDuplicates(0);
    if (!selected) return;
    if (selected.size > 10_000_000) {
      setError('Arquivo maior que 10 MB.');
      return;
    }
    try {
      const content = await selected.text();
      const parsed = kind === 'calendar_ics' ? [] : parseCsv(content);
      const headers = headersFor(parsed);
      setText(content);
      setRows(parsed);
      setFile(selected);
      setColumns({
        date: guess(headers, ['date', 'data']),
        description: guess(headers, ['description', 'descricao', 'historico']),
        amount: guess(headers, ['amount', 'amount_brl', 'valor']),
        type: guess(headers, ['type', 'tipo']),
        account: guess(headers, ['account', 'conta']),
        category: guess(headers, ['category', 'categoria']),
      });
    } catch (cause) {
      setError(`Arquivo não aceito. ${String(cause)}`);
    }
  }
  async function commit() {
    if (
      !file ||
      !confirmed ||
      prepared.error ||
      (prepared.issues.length > 0 && !importValidOnly) ||
      !prepared.values.length ||
      (kind === 'finance_csv' && !account)
    )
      return;
    setBusy(true);
    setError('');
    setResult('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await fileHash(bytes);
      const db = await getDatabase();
      await db.execute(
        `INSERT INTO data_import_batches(id,kind,file_name,file_hash,account_id,row_count,imported_at,payload_json,conflict_policy)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          crypto.randomUUID(),
          kind,
          file.name.slice(0, 255),
          hash,
          kind === 'finance_csv' ? account : null,
          prepared.values.length,
          new Date().toISOString(),
          JSON.stringify(prepared.values),
          conflictPolicy,
        ],
      );
      await onImported();
      await loadHistory();
      setResult(
        `${prepared.values.length} linhas válidas processadas. Histórico salvo neste computador.${kind === 'finance_csv' ? '' : ` Conflitos: ${conflictPolicy === 'skip' ? 'ignorados' : 'atualizados'}.`}`,
      );
      setConfirmed(false);
    } catch (cause) {
      setError(`Nada foi importado. ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="data-import">
      <h3>Importar dados</h3>
      <p>Confira a prévia antes de gravar. O arquivo é lido somente neste computador.</p>
      <label>
        Tipo
        <select
          value={kind}
          disabled={busy}
          onChange={(event) => {
            setKind(event.target.value as Kind);
            setFile(null);
            setRows([]);
            setText('');
            setConfirmed(false);
            setResult('');
          }}
        >
          <option value="finance_csv">Transações · CSV</option>
          <option value="body_csv">Progresso corporal · CSV</option>
          <option value="calendar_ics">Eventos externos · ICS</option>
        </select>
      </label>
      <label>
        Arquivo
        <input
          type="file"
          accept={kind === 'calendar_ics' ? '.ics,text/calendar' : '.csv,text/csv'}
          disabled={busy}
          onChange={(event) => void choose(event.target.files?.[0] ?? null)}
        />
      </label>
      {kind === 'finance_csv' && file && (
        <>
          <label>
            Conta de destino
            <select value={account} onChange={(event) => setAccount(event.target.value)}>
              <option value="">Selecione</option>
              {accounts.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name}
                </option>
              ))}
            </select>
          </label>
          {(['date', 'description', 'amount', 'type', 'account', 'category'] as const).map(
            (field) => (
              <label key={field}>
                {
                  {
                    date: 'Data',
                    description: 'Descrição',
                    amount: 'Valor',
                    type: 'Tipo (opcional)',
                    account: 'Conta no arquivo (opcional)',
                    category: 'Categoria no arquivo (opcional)',
                  }[field]
                }
                <select
                  value={columns[field] ?? -1}
                  onChange={(event) =>
                    setColumns((current) => ({ ...current, [field]: Number(event.target.value) }))
                  }
                >
                  <option value={-1}>Selecione</option>
                  {headersFor(rows).map((header, index) => (
                    <option key={index} value={index}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ),
          )}
          <label>
            Tipo quando o arquivo não informa
            <select
              value={defaultType}
              onChange={(event) => setDefaultType(event.target.value as 'expense' | 'income')}
            >
              <option value="expense">Despesa</option>
              <option value="income">Receita</option>
            </select>
          </label>
        </>
      )}
      {file && (
        <>
          <p>
            {prepared.values.length} válidos, {prepared.issues.length} com problema.{' '}
            {prepared.values.length > 10 ? 'Mostrando os primeiros 10.' : ''}
          </p>
          {prepared.issues.length > 0 && (
            <>
              <ul>
                {prepared.issues.slice(0, 10).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <label className="data-import-check">
                <input
                  type="checkbox"
                  checked={importValidOnly}
                  disabled={busy}
                  onChange={(event) => setImportValidOnly(event.target.checked)}
                />
                <span>Importar somente as linhas válidas; as demais ficarão fora do RUMAR.</span>
              </label>
            </>
          )}
          {kind !== 'finance_csv' && (
            <label>
              {conflicts} {kind === 'body_csv' ? 'datas' : 'UIDs'} já existem. Em conflitos:
              <select
                value={conflictPolicy}
                disabled={busy}
                onChange={(event) => setConflictPolicy(event.target.value as 'update' | 'skip')}
              >
                <option value="skip">Ignorar registros existentes</option>
                <option value="update">Atualizar registros existentes</option>
              </select>
            </label>
          )}
          {kind === 'finance_csv' && probableDuplicates > 0 && (
            <p role="status">
              {probableDuplicates} possível(is) duplicata(s) por data, valor, descrição e conta.
              Revise antes de importar; nenhuma linha será removida automaticamente.
            </p>
          )}
          {prepared.error ? (
            <p role="alert">{prepared.error}</p>
          ) : (
            <div className="data-import-preview">
              {kind === 'finance_csv' ? (
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Descrição</th>
                      <th>Tipo</th>
                      <th>Valor</th>
                      <th>Conta</th>
                      <th>Categoria</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(prepared.values as FinanceImportRow[]).slice(0, 10).map((row) => (
                      <tr key={row.id}>
                        <td>{row.date}</td>
                        <td>{row.description}</td>
                        <td>{row.transaction_type === 'income' ? 'Receita' : 'Despesa'}</td>
                        <td>{money.format(row.amount_cents / 100)}</td>
                        <td>
                          {row.account_name ||
                            accounts.find((value) => value.id === account)?.name ||
                            'Conta de destino'}
                        </td>
                        <td>{row.category_name || 'Sem categoria'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : kind === 'body_csv' ? (
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Medidas</th>
                      <th>Observações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(prepared.values as BodyImportRow[]).slice(0, 10).map((row) => (
                      <tr key={row.id}>
                        <td>{row.date}</td>
                        <td>
                          {Object.entries(row.metrics)
                            .map(
                              ([key, value]) =>
                                `${metricLabels[key] ?? key}: ${value.toLocaleString('pt-BR')}`,
                            )
                            .join(' · ') || 'Sem medidas'}
                        </td>
                        <td>{row.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Início</th>
                      <th>Evento</th>
                      <th>Fim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(prepared.values as CalendarImportRow[]).slice(0, 10).map((row) => (
                      <tr key={row.id}>
                        <td>
                          {row.start_date}
                          {row.start_time ? ` ${row.start_time}` : ''}
                        </td>
                        <td>{row.summary}</td>
                        <td>
                          {row.end_date
                            ? `${row.end_date}${row.end_time ? ` ${row.end_time}` : ''}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <label className="data-import-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || Boolean(prepared.error) || !prepared.values.length}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>Conferi a prévia e quero importar esses registros.</span>
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={
              busy ||
              !confirmed ||
              Boolean(prepared.error) ||
              (prepared.issues.length > 0 && !importValidOnly) ||
              !prepared.values.length ||
              (kind === 'finance_csv' && !account)
            }
            onClick={() => void commit()}
          >
            {busy ? 'Importando…' : 'Confirmar importação'}
          </button>
        </>
      )}
      {result && <p role="status">{result}</p>}
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>Histórico de importações</summary>
        {history.length === 0 ? (
          <p>Nenhuma importação registrada.</p>
        ) : (
          <ul>
            {history.map((batch) => (
              <li key={batch.id}>
                {batch.file_name} ·{' '}
                {batch.kind === 'finance_csv'
                  ? 'Finanças CSV'
                  : batch.kind === 'body_csv'
                    ? 'Progresso corporal CSV'
                    : 'Calendário ICS'}{' '}
                · {batch.row_count} registros ·{' '}
                {new Date(batch.imported_at).toLocaleString('pt-BR')}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
