import { useEffect, useState } from 'react';
import { getDatabase } from '../../../lib/database/connection';
import type { MirrorKind } from './domain';

export function GoogleMirrorControl({
  kind,
  id,
}: {
  kind: Exclude<MirrorKind, 'block_exception'>;
  id: string;
}) {
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void getDatabase()
      .then((db) =>
        db.select<{ enabled: number }[]>(
          'SELECT enabled FROM google_calendar_item_preferences WHERE entity_type=$1 AND entity_id=$2',
          [kind, id],
        ),
      )
      .then((rows) => {
        if (live) {
          setEnabled(rows[0]?.enabled !== 0);
          setBusy(false);
        }
      })
      .catch(() => {
        if (live) setError('Erro ao carregar espelhamento.');
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
          checked={enabled}
          onChange={(event) => {
            const next = event.target.checked;
            setBusy(true);
            setError('');
            void getDatabase()
              .then((db) =>
                db.execute(
                  'INSERT INTO google_calendar_item_preferences(entity_type,entity_id,enabled) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET enabled=excluded.enabled',
                  [kind, id, next ? 1 : 0],
                ),
              )
              .then(() => setEnabled(next))
              .catch(() => setError('Não foi possível salvar o espelhamento.'))
              .finally(() => setBusy(false));
          }}
        />{' '}
        Espelhar no Google Agenda
      </label>
      <p className="field-help">
        Também depende da fonte e da conexão em Configurações. Não altera este item no RUMO.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
