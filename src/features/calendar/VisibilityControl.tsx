import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { CalendarPreferences, type CalendarSource } from './preferences';
export function VisibilityControl({ kind, id }: { kind: CalendarSource; id: string }) {
  const [visible, setVisible] = useState(true),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void getDatabase()
      .then((db) => new CalendarPreferences(db).overrides())
      .then((rows) => {
        if (live) {
          setVisible(rows.find((r) => r.entity_type === kind && r.entity_id === id)?.visible !== 0);
          setBusy(false);
        }
      })
      .catch(() => {
        if (live) setError('Erro ao carregar visibilidade.');
      });
    return () => {
      live = false;
    };
  }, [kind, id]);
  return (
    <div>
      <label>
        <input
          type="checkbox"
          disabled={busy}
          checked={visible}
          onChange={(e) => {
            const next = e.target.checked;
            setBusy(true);
            setError('');
            void getDatabase()
              .then((db) => new CalendarPreferences(db).item(kind, id, next))
              .then(() => setVisible(next))
              .catch(() => setError('Não foi possível salvar visibilidade.'))
              .finally(() => setBusy(false));
          }}
        />{' '}
        Mostrar no calendário
      </label>
      <p className="field-help">
        Preferência independente; não altera Home, recorrência ou histórico.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
