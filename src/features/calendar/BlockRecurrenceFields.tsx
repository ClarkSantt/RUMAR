import { weekdays, localDate } from '../../lib/dates';
import { defaultBlockRecurrence, type BlockRecurrence } from './block-recurrence';
export function BlockRecurrenceFields({
  value,
  onChange,
  allowNone = true,
}: {
  value: BlockRecurrence | null;
  onChange: (rule: BlockRecurrence | null) => void;
  allowNone?: boolean;
}) {
  return (
    <fieldset>
      <legend>Repetir</legend>
      <label>
        Frequência
        <select
          value={value?.frequency ?? 'none'}
          onChange={(e) =>
            onChange(
              e.target.value === 'none'
                ? null
                : {
                    ...(value ?? defaultBlockRecurrence()),
                    frequency: e.target.value as BlockRecurrence['frequency'],
                  },
            )
          }
        >
          <option value="none" disabled={!allowNone}>
            Não repetir
          </option>
          <option value="daily">Todos os dias</option>
          <option value="weekdays">Dias úteis</option>
          <option value="weekly">Semanal / personalizado</option>
          <option value="monthly">Todo mês</option>
        </select>
      </label>
      {value && (
        <>
          <label>
            Repetir a cada
            <input
              type="number"
              min="1"
              max="52"
              value={value.interval}
              disabled={value.frequency === 'weekdays'}
              onChange={(e) => onChange({ ...value, interval: Number(e.target.value) })}
            />
            <span className="field-help">
              {value.frequency === 'monthly'
                ? 'meses'
                : value.frequency === 'daily'
                  ? 'dias'
                  : 'semanas'}
            </span>
          </label>
          {value.frequency === 'weekly' && (
            <div className="review-actions">
              {weekdays.map((d) => (
                <label key={d.value}>
                  <input
                    type="checkbox"
                    checked={value.weekdays.includes(d.value)}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        weekdays: e.target.checked
                          ? [...value.weekdays, d.value]
                          : value.weekdays.filter((w) => w !== d.value),
                      })
                    }
                  />
                  {d.short}
                </label>
              ))}
            </div>
          )}
          <label>
            Termina
            <select
              value={value.until ? 'until' : value.count ? 'count' : 'never'}
              onChange={(e) =>
                onChange({
                  ...value,
                  until: e.target.value === 'until' ? localDate() : null,
                  count: e.target.value === 'count' ? 10 : null,
                })
              }
            >
              <option value="never">Nunca</option>
              <option value="until">Em data específica</option>
              <option value="count">Após X ocorrências</option>
            </select>
          </label>
          {value.until !== null && (
            <label>
              Última data
              <input
                type="date"
                required
                value={value.until}
                onChange={(e) => onChange({ ...value, until: e.target.value })}
              />
            </label>
          )}
          {value.count !== null && (
            <label>
              Ocorrências
              <input
                type="number"
                min="1"
                max="10000"
                required
                value={value.count}
                onChange={(e) => onChange({ ...value, count: Number(e.target.value) })}
              />
            </label>
          )}
          <p className="field-help">
            Recorrência do tempo reservado, independente da tarefa ou plano de treino. Dia mensal
            inexistente usa o último dia do mês.
          </p>
        </>
      )}
    </fieldset>
  );
}
