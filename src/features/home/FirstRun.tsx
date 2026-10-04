import { useState } from 'react';
import type { RumoStore } from '../../hooks/useRumo';
import { getDatabase } from '../../lib/database/connection';

export function FirstRun({ store, onDone }: { store: RumoStore; onDone: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="first-run">
      <p className="eyebrow">BEM-VINDO AO RUMAR</p>
      <h2>Seu espaço pessoal para organizar o que importa.</h2>
      <p>
        Funciona neste computador, sem conta. Depois de começar, você pode informar seus dados uma
        vez em Perfil; o RUMAR usa o peso registrado no Progresso corporal para as estimativas.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            setBusy(true);
            setError('');
            try {
              if (name.trim()) {
                const saved = await store.run((repo) => repo.saveSetting('name', name.trim()));
                if (!saved) throw new Error('Não foi possível salvar seu nome.');
              }
              await (
                await getDatabase()
              ).execute(
                "INSERT INTO settings(key,value,updated_at) VALUES('welcome_complete','1',$1) ON CONFLICT(key) DO UPDATE SET value='1',updated_at=$1",
                [new Date().toISOString()],
              );
              onDone();
            } catch {
              setError('Não foi possível concluir. Tente novamente.');
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label htmlFor="first-run-name">Como gostaria de ser chamado?</label>
        <div className="name-field">
          <input
            id="first-run-name"
            value={name}
            maxLength={80}
            placeholder="Seu nome"
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
          <button className="primary-button" disabled={busy}>
            Começar
          </button>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
