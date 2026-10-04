import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { getDatabase } from '../../../lib/database/connection';
import { parseLoad, loadLabels } from '../domain';
import { SessionsRepository } from '../repositories/sessions';
import { WorkoutWriter } from '../persistence';
import type { LoadType, SetType, WorkoutSet } from '../types';

type Draft = {
  load: string;
  reps: string;
  completed: number;
  load_type: LoadType;
  set_type: SetType;
  notes: string;
};
export function SetRow({
  set,
  onRemove,
  onSaved,
}: {
  set: WorkoutSet;
  onRemove: () => void;
  onSaved?: (set: WorkoutSet) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    load: set.load_value === null ? '' : String(set.load_value).replace('.', ','),
    reps: set.reps === null ? '' : String(set.reps),
    completed: set.completed,
    load_type: set.load_type,
    set_type: set.set_type,
    notes: set.notes,
  });
  const latest = useRef(draft),
    initial = useRef(set),
    writer = useRef<WorkoutWriter<Draft> | null>(null),
    saved = useRef(onSaved);
  const setId = set.id;
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved'),
    [error, setError] = useState('');
  useEffect(() => {
    saved.current = onSaved;
  }, [onSaved]);
  useEffect(() => {
    const queue = new WorkoutWriter<Draft>(async (value) => {
      try {
        if (value.reps !== '' && !/^\d+$/.test(value.reps))
          throw Error('Informe repetições inteiras.');
        const input = {
          load_value:
            value.load_type === 'none' ? null : value.load === '' ? null : parseLoad(value.load),
          reps: value.reps === '' ? null : Number(value.reps),
          load_type: value.load_type,
          set_type: value.set_type,
          completed: value.completed,
          notes: value.notes,
        };
        await new SessionsRepository(await getDatabase()).saveSet(setId, input);
        setError('');
        saved.current?.({ ...initial.current, ...input });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Não foi possível salvar esta série.');
        throw reason;
      }
    }, setStatus);
    writer.current = queue;
    return () => {
      writer.current = null;
      void queue.dispose().catch(() => {});
    };
  }, [setId]);
  function change(patch: Partial<Draft>, immediate = false) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setDraft(next);
    writer.current?.edit(next);
    if (immediate) void writer.current?.flush().catch(() => {});
  }
  const label = `Série ${set.set_number}`;
  return (
    <div className="workout-set" role="group" aria-label={label}>
      <span className="workout-set-number">{set.set_number}</span>
      <label>
        Carga
        <input
          aria-label={`${label}: carga`}
          inputMode="decimal"
          value={draft.load}
          disabled={draft.load_type === 'none'}
          placeholder={draft.load_type === 'bodyweight' ? '+ kg' : '0'}
          onChange={(e) => change({ load: e.target.value })}
          onBlur={() => void writer.current?.flush().catch(() => {})}
        />
      </label>
      <label>
        Reps
        <input
          aria-label={`${label}: repetições`}
          inputMode="numeric"
          value={draft.reps}
          placeholder="0"
          onChange={(e) => change({ reps: e.target.value })}
          onBlur={() => void writer.current?.flush().catch(() => {})}
        />
      </label>
      <label className="workout-set-check">
        <input
          type="checkbox"
          aria-label={`${label}: concluída`}
          checked={!!draft.completed}
          onChange={(e) => change({ completed: Number(e.target.checked) }, true)}
        />
        Feita
      </label>
      <button
        className="icon-button"
        aria-label={`Remover ${label.toLowerCase()}`}
        onClick={onRemove}
      >
        <Trash2 size={16} />
      </button>
      <details className="workout-set-options">
        <summary>
          Tipo, unidade e nota ·{' '}
          {status === 'saved' ? 'Salvo' : status === 'saving' ? 'Salvando…' : 'Erro ao salvar'}
        </summary>
        <div className="form-grid">
          <label>
            Tipo de série
            <select
              value={draft.set_type}
              onChange={(e) => change({ set_type: e.target.value as SetType }, true)}
            >
              <option value="normal">Normal</option>
              <option value="warmup">Aquecimento</option>
              <option value="drop">Drop set</option>
            </select>
          </label>
          <label>
            Unidade registrada
            <select
              value={draft.load_type}
              onChange={(e) => change({ load_type: e.target.value as LoadType }, true)}
            >
              {Object.entries(loadLabels).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Observação da série
          <input value={draft.notes} onChange={(e) => change({ notes: e.target.value })} />
        </label>
      </details>
      {status === 'error' && (
        <div className="workout-set-error" role="alert">
          {error}{' '}
          <button
            className="text-button"
            onClick={() => void writer.current?.flush().catch(() => {})}
          >
            Tentar salvar novamente
          </button>
        </div>
      )}
    </div>
  );
}
