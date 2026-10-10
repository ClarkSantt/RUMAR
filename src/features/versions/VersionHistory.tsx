import { useEffect, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { getDatabase } from '../../lib/database/connection';
import { VersionsRepository, type EntityVersion, type VersionEntityType } from './repository';

const fieldLabels: Record<string, string> = {
  title: 'título',
  content: 'conteúdo',
  name: 'nome',
  description: 'descrição',
  start_date: 'data inicial',
  target_date: 'prazo',
  horizon: 'horizonte',
  horizon_label: 'período',
  progress: 'configuração de progresso',
};

function snapshotFields(snapshot: string) {
  try {
    return Object.entries(JSON.parse(snapshot) as Record<string, unknown>).filter(
      ([, value]) => value !== null && value !== '',
    );
  } catch {
    return [];
  }
}

export function VersionHistory({
  type,
  entityId,
  onRestored,
}: {
  type: VersionEntityType;
  entityId: string;
  onRestored: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<EntityVersion[]>([]);
  const [restoring, setRestoring] = useState<EntityVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    void getDatabase()
      .then((db) => new VersionsRepository(db).list(type, entityId))
      .then(setRows)
      .catch(() => setError('Não foi possível carregar o histórico.'));
  }, [open, type, entityId]);
  async function restore() {
    if (!restoring) return;
    setBusy(true);
    setError('');
    try {
      await new VersionsRepository(await getDatabase()).restore(restoring, true);
      setRestoring(null);
      setOpen(false);
      await onRestored();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível restaurar a versão.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="secondary-button" onClick={() => setOpen(true)}>
        <History size={15} /> Histórico
      </button>
      {open && (
        <Dialog
          title="Histórico de versões"
          onClose={() => setOpen(false)}
          busy={busy}
          error={error}
        >
          {!rows.length ? (
            <p>Ainda não há versões anteriores.</p>
          ) : (
            <div className="version-list">
              {rows.map((row) => (
                <div className="review-line" key={row.id}>
                  <div>
                    <strong>
                      {row.changed_fields
                        .split(' ')
                        .map((field) => fieldLabels[field] ?? field)
                        .join(', ')}
                    </strong>
                    <span>{new Date(row.created_at).toLocaleString('pt-BR')}</span>
                    <details>
                      <summary>Ver versão anterior</summary>
                      <dl className="version-snapshot">
                        {snapshotFields(row.snapshot_json).map(([field, value]) => (
                          <div key={field}>
                            <dt>{fieldLabels[field] ?? field.replaceAll('_', ' ')}</dt>
                            <dd>{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setOpen(false);
                      setRestoring(row);
                    }}
                  >
                    <RotateCcw size={15} /> Restaurar
                  </button>
                </div>
              ))}
            </div>
          )}
        </Dialog>
      )}
      {restoring && (
        <Dialog
          title="Restaurar versão anterior?"
          onClose={() => setRestoring(null)}
          busy={busy}
          error={error}
        >
          <p>O estado atual será preservado como uma nova versão antes da restauração.</p>
          <div className="form-actions">
            <button className="secondary-button" onClick={() => setRestoring(null)} disabled={busy}>
              Cancelar
            </button>
            <button className="primary-button" onClick={() => void restore()} disabled={busy}>
              Restaurar versão
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
