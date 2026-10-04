import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { RumoStore } from '../../hooks/useRumo';
import type { Theme } from '../../types/models';
import { closeDatabase, getDatabase } from '../../lib/database/connection';
import { flushThoughts } from '../thoughts/autosave';
import { flushWorkouts } from '../workouts/persistence';
import { GeneralProfile } from '../energy/GeneralProfile';
import { TemplatesGallery } from '../templates/TemplatesGallery';
import { NotificationSettings } from '../notifications/NotificationSettings';
import { TimelineRepository } from '../timeline/repository';
import { PlannerSettings } from '../calendar/PlannerSettings';
import { pauseOpenFocus } from '../calendar/focus';
import { AutomationsSettings } from '../automations/AutomationsSettings';
import { suspendAutomations } from '../automations/runtime';
import { suspendLocalNotifications } from '../notifications/scheduler';
import { DataCenter } from '../data/DataCenter';
import { GoogleCalendarSettings } from '../integrations/google-calendar/GoogleCalendarSettings';
import { WindowsSettings } from '../windows/WindowsSettings';
import { suspendGoogleCalendar } from '../integrations/google-calendar/runtime';
import '../automations/automations.css';
const themes: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Escuro', Icon: Moon },
  { value: 'system', label: 'Sistema', Icon: Monitor },
];
export function Settings({ store }: { store: RumoStore }) {
  const [name, setName] = useState(store.data!.settings.name);
  const [dataInfo, setDataInfo] = useState<{ databasePath: string; appVersion: string } | null>(
    null,
  );
  const [frequency, setFrequency] = useState('off');
  const [keepCount, setKeepCount] = useState(10);
  const [lastAutomatic, setLastAutomatic] = useState<string | null>(null);
  const [hideValues, setHideValues] = useState(false);
  const [timelinePrivate, setTimelinePrivate] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [selected, setSelected] = useState<{
    path: string;
    schemaVersion: number;
    createdAt: string;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([
      invoke<{ databasePath: string; appVersion: string }>('data_info'),
      getDatabase().then((db) =>
        db.select<{ frequency: string; keep_count: number; last_auto_at: string | null }[]>(
          'SELECT frequency,keep_count,last_auto_at FROM backup_preferences WHERE id=1',
        ),
      ),
      getDatabase().then((db) =>
        db.select<{ hide_values: number }[]>(
          'SELECT hide_values FROM finance_preferences WHERE id=1',
        ),
      ),
      getDatabase().then((db) => new TimelineRepository(db).privateMode()),
    ])
      .then(([info, rows, privacy, privateMode]) => {
        if (!active) return;
        setDataInfo(info);
        setFrequency(rows[0]?.frequency ?? 'off');
        setKeepCount(rows[0]?.keep_count ?? 10);
        setLastAutomatic(rows[0]?.last_auto_at ?? null);
        setHideValues(Boolean(privacy[0]?.hide_values));
        setTimelinePrivate(privateMode);
      })
      .catch((cause) => active && setError(String(cause)));
    return () => {
      active = false;
    };
  }, []);
  async function action(work: () => Promise<string>) {
    setBusy(true);
    setError('');
    setResult('');
    try {
      setResult(await work());
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  async function manualBackup() {
    const path = await save({
      defaultPath: `RUMAR-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Backup RUMAR', extensions: ['zip'] }],
    });
    if (!path) return;
    await action(async () => {
      await flushThoughts();
      await flushWorkouts();
      await pauseOpenFocus();
      const resume = await suspendAutomations();
      const resumeNotifications = await suspendLocalNotifications();
      const resumeGoogle = await suspendGoogleCalendar();
      try {
        await invoke('create_backup', { destination: path });
      } finally {
        resumeGoogle();
        resumeNotifications();
        resume();
      }
      return `Backup criado em ${path}`;
    });
  }
  async function chooseRestore() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Backup RUMAR', extensions: ['zip'] }],
    });
    if (!path || typeof path !== 'string') return;
    await action(async () => {
      const manifest = await invoke<{ schemaVersion: number; createdAt: string }>(
        'inspect_backup',
        { source: path },
      );
      setSelected({ path, ...manifest });
      setConfirmed(false);
      return 'Backup validado. Confira os dados abaixo antes de restaurar.';
    });
  }
  async function restore() {
    if (!selected || !confirmed) return;
    await action(async () => {
      await flushThoughts();
      await flushWorkouts();
      await pauseOpenFocus();
      const resume = await suspendAutomations();
      const resumeNotifications = await suspendLocalNotifications();
      const resumeGoogle = await suspendGoogleCalendar();
      try {
        await closeDatabase();
        await invoke('restore_backup', { source: selected.path });
        await invoke('restart_after_restore');
        return 'Backup restaurado. Reabrindo o RUMAR…';
      } catch (cause) {
        await store.retry();
        throw cause;
      } finally {
        resumeGoogle();
        resumeNotifications();
        resume();
      }
    });
  }
  return (
    <>
      <header className="page-header">
        <p className="eyebrow">DO SEU JEITO</p>
        <h1>Configurações</h1>
        <p>Pequenos ajustes para se sentir em casa.</p>
      </header>
      <section className="settings-section">
        <h2>Perfil</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void store.run((repo) => repo.saveSetting('name', name), 'Nome salvo.');
          }}
        >
          <label htmlFor="profile-name">Como podemos chamar você?</label>
          <div className="name-field">
            <input
              id="profile-name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={store.busy}
            />
            <button className="secondary-button" disabled={store.busy || !name.trim()}>
              Salvar
            </button>
          </div>
        </form>
        <GeneralProfile />
      </section>
      <section className="settings-section">
        <h2>Aparência</h2>
        <p>Escolha o tema do RUMAR.</p>
        <div className="theme-options" role="group" aria-label="Tema">
          {themes.map(({ value, label, Icon }) => (
            <button
              key={value}
              aria-pressed={store.data!.settings.theme === value}
              disabled={store.busy}
              onClick={() => void store.run((repo) => repo.saveSetting('theme', value))}
            >
              <Icon size={22} />
              {label}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <h2>Preferências</h2>
        <div className="preference-row">
          <span>Primeiro dia da semana</span>
          <strong>Segunda-feira</strong>
        </div>
      </section>
      <WindowsSettings />
      <section className="settings-section">
        <h2>Templates</h2>
        <p>Reutilize estruturas de tarefas, projetos, rotinas, planos de treino e refeições.</p>
        <button
          className="secondary-button"
          aria-expanded={templatesOpen}
          onClick={() => setTemplatesOpen((current) => !current)}
        >
          {templatesOpen ? 'Fechar templates' : 'Abrir meus templates'}
        </button>
        {templatesOpen && <TemplatesGallery />}
      </section>
      <section className="settings-section">
        <h2>Notificações</h2>
        <NotificationSettings />
      </section>
      <section className="settings-section">
        <h2>Dados</h2>
        <DataCenter onImported={store.retry} />
        <p>O banco fica neste computador. Backups manuais são salvos onde você escolher.</p>
        {dataInfo && (
          <p className="data-path">
            <strong>Banco local:</strong> {dataInfo.databasePath}
          </p>
        )}
        <div className="name-field backup-preferences">
          <label htmlFor="backup-frequency">Backup automático</label>
          <select
            id="backup-frequency"
            value={frequency}
            disabled={busy}
            onChange={(event) => setFrequency(event.target.value)}
          >
            <option value="off">Desativado</option>
            <option value="daily">Diário</option>
            <option value="weekly">Semanal</option>
          </select>
          <label htmlFor="backup-keep">Manter</label>
          <input
            id="backup-keep"
            type="number"
            min="1"
            max="50"
            value={keepCount}
            disabled={busy}
            onChange={(event) => setKeepCount(Number(event.target.value))}
          />
          <button
            className="secondary-button"
            disabled={busy || keepCount < 1 || keepCount > 50}
            onClick={() =>
              void action(async () => {
                const db = await getDatabase();
                await db.execute(
                  'UPDATE backup_preferences SET frequency=$1,keep_count=$2 WHERE id=1',
                  [frequency, keepCount],
                );
                const backup = await invoke<string | null>('automatic_backup');
                if (backup) setLastAutomatic(String(Math.floor(Date.now() / 1000)));
                return 'Preferência de backup salva.';
              })
            }
          >
            Salvar backup automático
          </button>
        </div>
        <p>
          Último backup automático:{' '}
          {lastAutomatic
            ? new Date(Number(lastAutomatic) * 1000).toLocaleString('pt-BR')
            : 'ainda não criado'}
        </p>
        <div className="name-field">
          <button className="secondary-button" disabled={busy} onClick={() => void manualBackup()}>
            Criar backup agora
          </button>
          <button className="secondary-button" disabled={busy} onClick={() => void chooseRestore()}>
            Restaurar backup
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void action(() => invoke<string>('check_integrity'))}
          >
            Verificar banco
          </button>
        </div>
        {selected && (
          <div className="settings-restore">
            <p>
              <strong>Backup selecionado:</strong> {selected.path}
            </p>
            <p>
              Schema {selected.schemaVersion} · criado em{' '}
              {new Date(Number(selected.createdAt) * 1000).toLocaleString('pt-BR')}
            </p>
            <p>Restaurar substituirá os dados atuais. O RUMAR criará antes um backup preventivo.</p>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />{' '}
              Entendo que os dados atuais serão substituídos
            </label>
            <button
              className="primary-button"
              disabled={busy || !confirmed}
              onClick={() => void restore()}
            >
              Confirmar restauração
            </button>
          </div>
        )}
        {result && <p role="status">{result}</p>}
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
      </section>
      <section className="settings-section">
        <h2>Privacidade</h2>
        <p>
          O RUMAR guarda seus dados localmente. Se você ativar Google Agenda, somente os eventos
          escolhidos serão enviados ao Google como espelho. Os backups contêm seus dados pessoais;
          guarde-os em local seguro.
        </p>
        <label className="preference-row">
          <input
            type="checkbox"
            checked={hideValues}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.checked;
              void action(async () => {
                await (
                  await getDatabase()
                ).execute('UPDATE finance_preferences SET hide_values=$1 WHERE id=1', [
                  next ? 1 : 0,
                ]);
                setHideValues(next);
                return 'Preferência de privacidade salva.';
              });
            }}
          />{' '}
          Ocultar valores financeiros
        </label>
        <label className="preference-row">
          <input
            type="checkbox"
            checked={timelinePrivate}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.checked;
              void action(async () => {
                await new TimelineRepository(await getDatabase()).setPrivateMode(next);
                setTimelinePrivate(next);
                return 'Privacidade da Timeline salva.';
              });
            }}
          />{' '}
          Ocultar conteúdo sensível na Timeline
        </label>
      </section>
      <PlannerSettings />
      <AutomationsSettings />
      <section className="settings-section">
        <h2>Integrações</h2>
        <GoogleCalendarSettings />
      </section>
      <section className="settings-section about">
        <h2>
          RUMAR <span>{dataInfo?.appVersion ?? '1.8.0'}</span>
        </h2>
        <p>Clareza para o seu dia.</p>
        <p>
          Seus dados ficam neste computador. A integração com Google Agenda é opcional e unilateral.
          Sem telemetria.
        </p>
      </section>
    </>
  );
}
