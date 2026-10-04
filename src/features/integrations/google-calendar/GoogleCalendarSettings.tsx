import { useEffect, useState } from 'react';
import { getDatabase } from '../../../lib/database/connection';
import { localDate } from '../../../lib/dates';
import { RealGoogleCalendarClient } from './client';
import type { GoogleSettings } from './domain';
import { suspendGoogleCalendar, syncGoogleCalendar } from './runtime';
import { GoogleSync } from './sync';

const sources = [
  ['sync_routines', 'Rotinas'],
  ['sync_time_blocks', 'Blocos de tempo'],
  ['sync_workouts', 'Treinos'],
  ['sync_tasks', 'Tarefas'],
  ['sync_objectives', 'Objetivos'],
  ['sync_milestones', 'Marcos'],
] as const;
async function loadState() {
  const db = await getDatabase();
  const client = new RealGoogleCalendarClient();
  const sync = new GoogleSync(db, client);
  let settings = await sync.settings();
  const credential = await client.hasCredential(settings.integration_id);
  if (settings.state === 'connected' && !credential) {
    await db.execute("UPDATE google_calendar_settings SET state='reconnect' WHERE id=1");
    settings = await sync.settings();
  }
  let calendarMissing = false;
  if (credential && settings.calendar_id && settings.state !== 'disconnected') {
    try {
      calendarMissing = !(await client.getCalendar(
        settings.integration_id,
        settings.client_id,
        settings.calendar_id,
      ));
      if (calendarMissing && settings.state !== 'reconnect') {
        await db.execute("UPDATE google_calendar_settings SET state='reconnect' WHERE id=1");
        settings = await sync.settings();
      }
    } catch {
      // Offline or transient Google failure is not evidence of a deleted calendar.
    }
  }
  return { settings, counts: await sync.counts(), calendarMissing };
}

export function GoogleCalendarSettings() {
  const [settings, setSettings] = useState<GoogleSettings | null>(null);
  const [counts, setCounts] = useState({ pending: 0, errors: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [calendarMissing, setCalendarMissing] = useState(false);
  async function service() {
    return new GoogleSync(await getDatabase(), new RealGoogleCalendarClient());
  }
  async function refresh() {
    const next = await loadState();
    setSettings(next.settings);
    setCounts(next.counts);
    setCalendarMissing(next.calendarMissing);
  }
  useEffect(() => {
    let active = true;
    void loadState()
      .then(({ settings: next, counts: queue, calendarMissing: missing }) => {
        if (!active) return;
        setSettings(next);
        setCounts(queue);
        setCalendarMissing(missing);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  async function action(work: (sync: GoogleSync) => Promise<string>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setMessage(await work(await service()));
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  if (!settings) return <p>{error || 'Carregando integração…'}</p>;
  const connected = settings.state === 'connected';
  return (
    <section aria-label="Google Agenda">
      <h3>Google Agenda</h3>
      <p>
        Espelho opcional de saída: o RUMO continua sendo a fonte de verdade. Alterações feitas no
        Google não voltam ao RUMO.
      </p>
      <p>
        Estado:{' '}
        <strong>
          {connected
            ? 'Conectado'
            : settings.state === 'reconnect'
              ? calendarMissing
                ? 'Agenda RUMO não encontrada'
                : 'Reconexão necessária'
              : 'Desconectado'}
        </strong>
        {settings.calendar_id ? ` · Agenda: ${settings.calendar_name}` : ''}
      </p>
      {!connected && (
        <>
          <label htmlFor="google-client-id">Client ID OAuth para aplicativo de desktop</label>
          <div className="name-field">
            <input
              id="google-client-id"
              value={settings.client_id}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setSettings({ ...settings, client_id: event.target.value })}
            />
            <button
              className="secondary-button"
              disabled={busy || !settings.client_id.trim()}
              onClick={() =>
                void action(async (sync) => {
                  await sync.saveSettings({ client_id: settings.client_id.trim() });
                  return 'Client ID salvo.';
                })
              }
            >
              Salvar ID
            </button>
          </div>
          <p>
            Use uma credencial OAuth Desktop própria. O login abre no navegador do sistema; o token
            fica no Gerenciador de Credenciais do Windows. Consulte GOOGLE_CALENDAR_SETUP.md para a
            configuração inicial.
          </p>
          <label htmlFor="google-first-sync">Iniciar espelhamento em</label>
          <input
            id="google-first-sync"
            type="date"
            value={settings.first_sync_from ?? localDate()}
            onChange={(event) => setSettings({ ...settings, first_sync_from: event.target.value })}
            disabled={busy}
          />
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              void action(async (sync) => {
                await sync.setFirstSyncFrom(settings.first_sync_from ?? localDate());
                return 'Data inicial salva.';
              })
            }
          >
            Salvar data inicial
          </button>
          <p>Escolha uma data recente para evitar copiar todo o histórico por engano.</p>
          <button
            className="primary-button"
            disabled={busy || !settings.client_id.trim()}
            onClick={() =>
              void action(async (sync) => {
                await sync.saveSettings({ client_id: settings.client_id.trim() });
                await sync.setFirstSyncFrom(settings.first_sync_from ?? localDate());
                await sync.connect();
                return 'Conectado. O primeiro envio ainda não começou; revise as fontes e use “Sincronizar agora” quando desejar.';
              })
            }
          >
            Conectar com Google
          </button>
        </>
      )}
      <div className="name-field">
        <label htmlFor="google-horizon">Período à frente</label>
        <select
          id="google-horizon"
          disabled={busy}
          value={settings.sync_horizon_days}
          onChange={(event) =>
            void action(async (sync) => {
              await sync.saveSettings({
                sync_horizon_days: Number(event.target.value) as 30 | 90 | -1,
              });
              return 'Período salvo.';
            })
          }
        >
          <option value={30}>30 dias</option>
          <option value={90}>90 dias</option>
          <option value={-1}>Sem limite futuro</option>
        </select>
      </div>
      <fieldset disabled={busy}>
        <legend>Fontes espelhadas</legend>
        {sources.map(([field, label]) => (
          <label key={field} className="preference-row">
            <input
              type="checkbox"
              checked={!!settings[field]}
              onChange={(event) =>
                void action(async (sync) => {
                  await sync.saveSettings({ [field]: event.target.checked ? 1 : 0 });
                  return 'Fonte atualizada.';
                })
              }
            />{' '}
            {label}
          </label>
        ))}
      </fieldset>
      <label className="preference-row">
        <input
          type="checkbox"
          checked={!!settings.automatic}
          disabled={busy}
          onChange={(event) =>
            void action(async (sync) => {
              await sync.saveSettings({ automatic: event.target.checked ? 1 : 0 });
              return 'Sincronização automática atualizada.';
            })
          }
        />{' '}
        Sincronizar automaticamente enquanto o RUMO estiver aberto e houver conexão
      </label>
      <label className="preference-row">
        <input
          type="checkbox"
          checked={settings.untimed_mode === 'all_day'}
          disabled={busy}
          onChange={(event) =>
            void action(async (sync) => {
              await sync.saveSettings({ untimed_mode: event.target.checked ? 'all_day' : 'skip' });
              return 'Eventos sem horário atualizados.';
            })
          }
        />{' '}
        Espelhar itens sem horário como eventos de dia inteiro
      </label>
      <label htmlFor="google-routine-duration">
        Duração padrão de rotinas com horário (minutos)
      </label>
      <input
        id="google-routine-duration"
        type="number"
        min={5}
        max={240}
        disabled={busy}
        value={settings.routine_minutes}
        onChange={(event) =>
          setSettings({ ...settings, routine_minutes: Number(event.target.value) })
        }
      />
      <button
        className="secondary-button"
        disabled={busy || settings.routine_minutes < 5 || settings.routine_minutes > 240}
        onClick={() =>
          void action(async (sync) => {
            await sync.saveSettings({ routine_minutes: settings.routine_minutes });
            return 'Duração salva.';
          })
        }
      >
        Salvar duração
      </button>
      <label className="preference-row">
        <input
          type="checkbox"
          checked={!!settings.delete_remote}
          disabled={busy}
          onChange={(event) =>
            void action(async (sync) => {
              await sync.saveSettings({ delete_remote: event.target.checked ? 1 : 0 });
              return 'Política de exclusão atualizada.';
            })
          }
        />{' '}
        Remover da agenda espelhada eventos apagados ou ocultos no RUMO
      </label>
      <p>
        Fila: {counts.pending} pendentes · {counts.errors} erros. Última sincronização:{' '}
        {settings.last_sync_at
          ? new Date(settings.last_sync_at).toLocaleString('pt-BR')
          : 'ainda não realizada'}
        .
      </p>
      {connected && !settings.sync_started && (
        <p>
          Planejamento existente: escolha 30 ou 90 dias, sem limite futuro, ou deixe para depois. O
          Google não receberá eventos até você iniciar a sincronização.
        </p>
      )}
      {total > 0 && <progress value={done} max={total} aria-label="Progresso da sincronização" />}
      <div className="name-field">
        <button
          className="secondary-button"
          disabled={busy || !connected}
          onClick={() =>
            void action(async () => {
              setDone(0);
              setTotal(0);
              await syncGoogleCalendar((current, maximum) => {
                setDone(current);
                setTotal(maximum);
              }, true);
              return 'Sincronização processada.';
            })
          }
        >
          Sincronizar agora
        </button>
        <button
          className="secondary-button"
          disabled={busy || !connected}
          onClick={() =>
            void action(async (sync) => {
              const resume = await suspendGoogleCalendar();
              try {
                await sync.disconnect();
              } finally {
                resume();
              }
              return 'Conta desconectada. Eventos já enviados permanecem na agenda.';
            })
          }
        >
          Desconectar
        </button>
        <button
          className="secondary-button"
          disabled={busy || !calendarMissing}
          onClick={() =>
            void action(async (sync) => {
              const resume = await suspendGoogleCalendar();
              try {
                await sync.recreateCalendar();
              } finally {
                resume();
              }
              return 'Agenda RUMO recriada. Sincronize para repor os eventos.';
            })
          }
        >
          Recriar agenda ausente
        </button>
      </div>
      {connected && (
        <div className="settings-restore">
          <p>
            Excluir a agenda secundária “RUMO” também remove os eventos que ela contém no Google.
            Digite EXCLUIR RUMO para confirmar.
          </p>
          <input
            aria-label="Confirmação de exclusão da agenda RUMO"
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
          />
          <button
            className="secondary-button"
            disabled={busy || deleteConfirmation !== 'EXCLUIR RUMO'}
            onClick={() =>
              void action(async (sync) => {
                const resume = await suspendGoogleCalendar();
                try {
                  await sync.deleteCalendar(deleteConfirmation);
                } finally {
                  resume();
                }
                setDeleteConfirmation('');
                return 'Agenda secundária excluída.';
              })
            }
          >
            Excluir agenda RUMO
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}
    </section>
  );
}
