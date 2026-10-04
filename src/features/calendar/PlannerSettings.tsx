import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { PlannerRepository, type PlannerPreferences } from './planner-repository';
export function PlannerSettings() {
  const [prefs, setPrefs] = useState<PlannerPreferences | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then((db) => new PlannerRepository(db).preferences())
      .then((p) => {
        if (active) setPrefs(p);
      })
      .catch(() => setMessage('Erro ao carregar preferências do planejador.'));
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="settings-section">
      <h2>Planejador diário</h2>
      {prefs && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void getDatabase()
              .then((db) => new PlannerRepository(db).savePreferences(prefs))
              .then(() => setMessage('Preferências salvas.'))
              .catch((e) => setMessage(String(e)))
              .finally(() => setBusy(false));
          }}
        >
          <div className="form-grid">
            <label>
              Início visual
              <input
                type="number"
                min="0"
                max="23"
                value={prefs.visual_start}
                onChange={(e) => setPrefs({ ...prefs, visual_start: Number(e.target.value) })}
              />
            </label>
            <label>
              Fim visual
              <input
                type="number"
                min="1"
                max="24"
                value={prefs.visual_end}
                onChange={(e) => setPrefs({ ...prefs, visual_end: Number(e.target.value) })}
              />
            </label>
            <label>
              Duração padrão
              <select
                value={prefs.default_minutes}
                onChange={(e) => setPrefs({ ...prefs, default_minutes: Number(e.target.value) })}
              >
                {[15, 30, 45, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} min
                  </option>
                ))}
              </select>
            </label>
            <label>
              Primeiro dia da semana
              <select
                value={prefs.week_start}
                onChange={(e) => setPrefs({ ...prefs, week_start: Number(e.target.value) })}
              >
                <option value="1">Segunda</option>
                <option value="0">Domingo</option>
              </select>
            </label>
          </div>
          <p className="field-help">
            A grade permite acessar todas as 24 horas; o intervalo visual orienta sua abertura.
          </p>
          <button className="secondary-button" disabled={busy}>
            Salvar preferências do planejador
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
