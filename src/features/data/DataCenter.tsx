import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { getDatabase } from '../../lib/database/connection';
import { csvOptions, exportCalendar, exportCsv, type CsvDataset } from './export';
import { ImportData } from './ImportData';
import { portableJson } from './json-export';

interface StorageReport {
  database_bytes: number;
  attachment_bytes: number;
  attachment_count: number;
  missing: number;
  mismatched: number;
  orphan_files: number;
}
interface StorageSummary {
  database_bytes: number;
  attachment_bytes: number;
  attachment_count: number;
  backup_bytes: number;
}

const mb = (bytes: number) =>
  `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;

export function DataCenter({ onImported }: { onImported: () => Promise<void> }) {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exportResult, setExportResult] = useState('');
  const [dataset, setDataset] = useState<CsvDataset | 'calendar' | 'full_json'>('tasks');
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  async function inspect() {
    setBusy(true);
    setError('');
    try {
      setReport(await invoke<StorageReport>('attachment_check'));
    } catch (cause) {
      setError(`Não foi possível verificar o armazenamento. ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    void invoke<StorageSummary>('attachment_stats')
      .then((found) => {
        if (active) setSummary(found);
      })
      .catch(() => {
        if (active) setError('Não foi possível consultar o espaço usado.');
      });
    return () => {
      active = false;
    };
  }, []);
  async function exportData() {
    if (dataset !== 'full_json' && (!from || !to || to < from)) {
      setError('Escolha um período válido.');
      return;
    }
    const extension = dataset === 'calendar' ? 'ics' : dataset === 'full_json' ? 'json' : 'csv';
    const destination = await save({
      defaultPath:
        dataset === 'full_json'
          ? `RUMAR-dados-${new Date().toISOString().slice(0, 10)}.json`
          : `RUMAR-${dataset}-${from}-${to}.${extension}`,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!destination) return;
    setBusy(true);
    setError('');
    setExportResult('');
    try {
      const db = await getDatabase();
      const content =
        dataset === 'calendar'
          ? await exportCalendar(db, from, to)
          : dataset === 'full_json'
            ? JSON.stringify(await portableJson(db), null, 2)
            : await exportCsv(db, dataset, from, to);
      await invoke('export_write', { destination, content });
      setExportResult(`Exportação concluída: ${destination}`);
    } catch (cause) {
      setError(`Exportação não concluída. ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="data-center">
      <h3>Armazenamento</h3>
      {summary && (
        <>
          <p>Banco SQLite: {mb(summary.database_bytes)}</p>
          <p>
            Anexos: {summary.attachment_count} arquivos · {mb(summary.attachment_bytes)}
          </p>
          <p>Backups: {mb(summary.backup_bytes)}</p>
          <p>
            Total estimado:{' '}
            {mb(summary.database_bytes + summary.attachment_bytes + summary.backup_bytes)}
          </p>
        </>
      )}
      {!report && <p>A verificação de integridade é executada somente quando solicitada.</p>}
      {report && (
        <>
          <p role="status">
            Anexos verificados: {report.attachment_count - report.missing - report.mismatched}/
            {report.attachment_count} íntegros.
          </p>
          {(report.missing > 0 || report.mismatched > 0 || report.orphan_files > 0) && (
            <p role="status">
              Verificação: {report.missing} ausentes, {report.mismatched} alterados,{' '}
              {report.orphan_files} arquivos sem vínculo.
            </p>
          )}
        </>
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void inspect()}
      >
        {busy ? 'Verificando…' : 'Verificar anexos'}
      </button>
      {error && <p role="alert">{error}</p>}
      <h3>Exportar dados</h3>
      <p>
        Crie um arquivo para usar fora do RUMAR. O JSON contém metadados dos anexos, mas não os
        arquivos. Para restaurar o RUMAR com anexos, use Backup.
      </p>
      <div className="name-field">
        <label>
          Dados
          <select
            value={dataset}
            disabled={busy}
            onChange={(event) =>
              setDataset(event.target.value as CsvDataset | 'calendar' | 'full_json')
            }
          >
            {csvOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} · CSV
              </option>
            ))}
            <option value="calendar">Calendário · ICS</option>
            <option value="full_json">Todos os dados · JSON</option>
          </select>
        </label>
        <label>
          De
          <input
            type="date"
            value={from}
            disabled={busy || dataset === 'full_json'}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={to}
            disabled={busy || dataset === 'full_json'}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void exportData()}
        >
          Exportar
        </button>
      </div>
      {exportResult && <p role="status">{exportResult}</p>}
      <ImportData onImported={onImported} />
    </div>
  );
}
