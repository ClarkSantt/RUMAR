import { useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import type { RumoStore } from '../../hooks/useRumo';
import { getDatabase } from '../../lib/database/connection';
import { TrashRepository, type TrashItem } from './repository';

const labels = {
  task: 'Tarefa',
  project: 'Projeto',
  objective: 'Objetivo',
  thought: 'Pensamento',
} as const;

export function Trash({ store }: { store: RumoStore }) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [removing, setRemoving] = useState<TrashItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setItems(await new TrashRepository(await getDatabase()).list());
  }
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then((db) => new TrashRepository(db).list())
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar a Lixeira.');
      });
    return () => {
      active = false;
    };
  }, [store.data]);
  async function restore(item: TrashItem) {
    setBusy(true);
    setError('');
    try {
      await new TrashRepository(await getDatabase()).trash(item.entity_type, item.id, false);
      await store.retry();
      await load();
      store.setNotice({ message: `${labels[item.entity_type]} restaurado.` });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível restaurar.');
    } finally {
      setBusy(false);
    }
  }
  async function permanentlyDelete() {
    if (!removing) return;
    setBusy(true);
    setError('');
    try {
      await new TrashRepository(await getDatabase()).permanentlyDelete(
        removing.entity_type,
        removing.id,
        true,
      );
      setRemoving(null);
      await store.retry();
      await load();
      store.setNotice({ message: 'Item excluído permanentemente.' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível excluir.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-trash">
      <h3>Lixeira</h3>
      <p>Itens removidos permanecem aqui até você restaurar ou excluir permanentemente.</p>
      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}
      {!items.length ? (
        <p className="field-help">A Lixeira está vazia.</p>
      ) : (
        <div className="settings-trash-list">
          {items.map((item) => (
            <div className="review-line" key={`${item.entity_type}:${item.id}`}>
              <div>
                <strong>{item.name}</strong>
                <span>
                  {labels[item.entity_type]} · removido em{' '}
                  {new Date(item.deleted_at).toLocaleString('pt-BR')}
                </span>
              </div>
              <div className="review-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void restore(item)}
                >
                  <RotateCcw size={15} /> Restaurar
                </button>
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() => setRemoving(item)}
                >
                  <Trash2 size={15} /> Excluir permanentemente
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {removing && (
        <Dialog
          title="Excluir permanentemente?"
          onClose={() => setRemoving(null)}
          busy={busy}
          error={error}
        >
          <p>
            <strong>{removing.name}</strong> e seus vínculos serão removidos sem possibilidade de
            desfazer.
          </p>
          <div className="form-actions">
            <button className="secondary-button" disabled={busy} onClick={() => setRemoving(null)}>
              Cancelar
            </button>
            <button
              className="primary-button danger"
              disabled={busy}
              onClick={() => void permanentlyDelete()}
            >
              Excluir permanentemente
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
