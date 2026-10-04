import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { getDatabase } from '../../lib/database/connection';
import { weekdays } from '../../lib/dates';
import type { Routine, RoutineInput, RoutineItem } from './domain';
import { RoutinesRepository } from './repository';
import { VisibilityControl } from '../calendar/VisibilityControl';
import { GoogleMirrorControl } from '../integrations/google-calendar/GoogleMirrorControl';
const repository = async () => new RoutinesRepository(await getDatabase());
export function RoutineEditor({
  routine,
  onClose,
  onSaved,
}: {
  routine: Routine | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<RoutineInput>(
      routine ?? {
        name: '',
        description: '',
        frequency: 'daily',
        weekdays: [1, 2, 3, 4, 5],
        time_of_day: null,
        active: 1,
      },
    ),
    [id, setId] = useState(routine?.id),
    [items, setItems] = useState<RoutineItem[]>([]),
    [title, setTitle] = useState(''),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmArchive, setConfirmArchive] = useState(false);
  const change = <K extends keyof RoutineInput>(key: K, value: RoutineInput[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  useEffect(() => {
    if (!id) return;
    let active = true;
    void repository()
      .then((r) => r.items(id))
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [id, revision]);
  async function action(callback: (r: RoutinesRepository) => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await callback(await repository());
      setRevision((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={id ? 'Editar rotina' : 'Nova rotina'}
      drawer
      onClose={id ? onSaved : onClose}
      busy={busy}
      error={error}
    >
      <div className="drawer-body">
        {id && <VisibilityControl kind="routine" id={id} />}
        {id && <GoogleMirrorControl kind="routine" id={id} />}
        <form
          className="habit-form"
          id="routine-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async (r) => {
              const key = await r.save(draft, id);
              if (id) onSaved();
              else setId(key);
            });
          }}
        >
          <label>
            Nome
            <input
              required
              maxLength={500}
              value={draft.name}
              onChange={(e) => change('name', e.target.value)}
            />
          </label>
          <label>
            Descrição
            <textarea
              value={draft.description}
              onChange={(e) => change('description', e.target.value)}
            />
          </label>
          <label>
            Frequência
            <select
              value={draft.frequency}
              onChange={(e) => change('frequency', e.target.value as RoutineInput['frequency'])}
            >
              <option value="daily">Todos os dias</option>
              <option value="weekdays">Dias da semana</option>
            </select>
          </label>
          {draft.frequency === 'weekdays' && (
            <div className="habit-days" role="group" aria-label="Dias da rotina">
              {weekdays.map((d) => (
                <label key={d.value}>
                  <input
                    type="checkbox"
                    checked={draft.weekdays.includes(d.value)}
                    onChange={(e) =>
                      change(
                        'weekdays',
                        e.target.checked
                          ? [...draft.weekdays, d.value]
                          : draft.weekdays.filter((v) => v !== d.value),
                      )
                    }
                  />
                  {d.short}
                </label>
              ))}
            </div>
          )}
          <label>
            Horário opcional
            <input
              type="time"
              value={draft.time_of_day ?? ''}
              onChange={(e) => change('time_of_day', e.target.value || null)}
            />
          </label>
          <label className="habit-inline">
            <input
              type="checkbox"
              checked={!!draft.active}
              onChange={(e) => change('active', e.target.checked ? 1 : 0)}
            />
            Rotina ativa
          </label>
        </form>
        <section className="habit-history">
          <h3>Sequência</h3>
          {!id ? (
            <p className="muted">Salve a rotina para adicionar seus itens.</p>
          ) : (
            <>
              <ul className="routine-items">
                {items.map((item, index) => (
                  <li key={item.id}>
                    <ItemTitle
                      item={item}
                      busy={busy}
                      save={(text) => void action((r) => r.updateItem(item.id, text))}
                    />
                    <div className="routine-item-controls">
                      <button
                        aria-label={`Mover ${item.title} para cima`}
                        disabled={busy || index === 0}
                        onClick={() => void action((r) => r.moveItem(item.id, -1))}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        aria-label={`Mover ${item.title} para baixo`}
                        disabled={busy || index === items.length - 1}
                        onClick={() => void action((r) => r.moveItem(item.id, 1))}
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        aria-label={`Excluir ${item.title}`}
                        disabled={busy}
                        onClick={() => void action((r) => r.removeItem(item.id))}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <form
                className="habit-quantity"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async (r) => {
                    await r.addItem(id, title);
                    setTitle('');
                  });
                }}
              >
                <input
                  style={{ flex: 1 }}
                  aria-label="Novo item da rotina"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                />
                <button className="secondary-button" disabled={busy || !title.trim()}>
                  Adicionar item
                </button>
              </form>
            </>
          )}
        </section>
      </div>
      <footer className="drawer-footer">
        {id &&
          (confirmArchive ? (
            <>
              <span>Arquivar rotina?</span>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() =>
                  void action(async (r) => {
                    await r.archive(id);
                    onSaved();
                  })
                }
              >
                Confirmar
              </button>
              <button onClick={() => setConfirmArchive(false)}>Cancelar</button>
            </>
          ) : (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setConfirmArchive(true)}
            >
              Arquivar
            </button>
          ))}
        <button form="routine-form" className="primary-button" disabled={busy}>
          {id ? 'Salvar rotina' : 'Salvar e adicionar itens'}
        </button>
      </footer>
    </Dialog>
  );
}
function ItemTitle({
  item,
  busy,
  save,
}: {
  item: RoutineItem;
  busy: boolean;
  save: (title: string) => void;
}) {
  const [value, setValue] = useState(item.title);
  return (
    <input
      className="routine-item-title"
      type="text"
      aria-label={`Item ${item.title}`}
      value={value}
      disabled={busy}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim() && value !== item.title) save(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) {
          e.preventDefault();
          save(value);
        }
      }}
    />
  );
}
