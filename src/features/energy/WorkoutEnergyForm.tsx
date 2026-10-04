import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { EnergyRepository } from './repository';
import type { WorkoutEnergy } from './domain';
export function WorkoutEnergyForm({
  kind,
  id,
  onSaved,
}: {
  kind: 'day' | 'session';
  id: string;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState<WorkoutEnergy>({
      method: 'estimated',
      minutes: kind === 'day' ? 60 : null,
      met: 3.5,
      calories: null,
    }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    void getDatabase()
      .then((db) => new EnergyRepository(db).energy(kind, id))
      .then((e) => {
        if (live && e) setDraft(e);
      })
      .catch(() => {
        if (live) setMessage('Erro ao carregar energia.');
      });
    return () => {
      live = false;
    };
  }, [kind, id]);
  return (
    <details className="secondary-section">
      <summary>
        Editar gasto estimado {kind === 'day' ? 'do plano' : 'do treino'} (opcional)
      </summary>
      <form
        className="energy-activity"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setMessage('');
          void getDatabase()
            .then((db) => new EnergyRepository(db).saveEnergy(kind, id, draft))
            .then(() => {
              setMessage('Salvo');
              onSaved?.();
            })
            .catch((e) => setMessage(e instanceof Error ? e.message : 'Erro ao salvar.'))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Método de energia
          <select
            value={draft.method}
            onChange={(e) =>
              setDraft({ ...draft, method: e.target.value as WorkoutEnergy['method'] })
            }
          >
            <option value="off">Não contabilizar</option>
            <option value="manual">Manual</option>
            <option value="estimated">Estimado por MET</option>
          </select>
        </label>
        {draft.method === 'manual' && (
          <label>
            Energia adicional (kcal)
            <input
              type="number"
              min="0"
              max="20000"
              step="any"
              required
              value={draft.calories ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  calories: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </label>
        )}
        {draft.method === 'estimated' && (
          <>
            <label>
              Duração (min; sessão vazia usa duração registrada)
              <input
                type="number"
                min="1"
                max="1440"
                required={kind === 'day'}
                value={draft.minutes ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    minutes: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Intensidade
              <select
                required
                value={draft.met ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, met: e.target.value === '' ? null : Number(e.target.value) })
                }
              >
                <option value="">Selecionar</option>
                <option value="3.5">Musculação geral · 3,5 MET</option>
                <option value="6">Musculação vigorosa · 6 MET</option>
              </select>
            </label>
          </>
        )}
        <button className="secondary-button" disabled={busy}>
          Salvar energia
        </button>
        <p role="status">{message}</p>
      </form>
      <p className="field-help">
        Sem ajuste, o RUMAR estima automaticamente a partir do peso e da duração registrada. O
        método usa (MET − 1) × 3,5 × peso / 200 × minutos, com 3,5 MET para musculação geral.
        Informe valores manuais somente se desejar substituí-los. Só sessões concluídas entram no
        balanço.
      </p>
    </details>
  );
}
