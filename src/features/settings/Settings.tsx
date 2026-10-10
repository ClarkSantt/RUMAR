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
import { Trash } from '../trash/Trash';
import { GoogleCalendarSettings } from '../integrations/google-calendar/GoogleCalendarSettings';
import { WindowsSettings } from '../windows/WindowsSettings';
import { suspendGoogleCalendar } from '../integrations/google-calendar/runtime';
import '../automations/automations.css';
import './settings.css';
const themes: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Escuro', Icon: Moon },
  { value: 'system', label: 'Sistema', Icon: Monitor },
];
const sections = [
  { id: 'general', label: 'Geral' },
  { id: 'appearance', label: 'Aparência' },
  { id: 'notifications', label: 'Notificações' },
  { id: 'planning', label: 'Planejamento' },
  { id: 'automations', label: 'Automações' },
  { id: 'windows', label: 'Windows' },
  { id: 'templates', label: 'Templates' },
  { id: 'data', label: 'Backup e dados' },
  { id: 'privacy', label: 'Privacidade' },
  { id: 'integrations', label: 'Integrações' },
  { id: 'about', label: 'Sobre' },
] as const;
type SettingsSection = (typeof sections)[number]['id'];
interface DataInfo {
  databasePath: string;
  automaticDirectory: string;
  appVersion: string;
}
interface BackupManifest {
  backupVersion: number;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  databaseSize: number;
  attachmentCount: number;
  kind: string;
  sha256: string;
}
interface HealthReport {
  sqlite: string;
  foreignKeys: string;
  schemaVersion: number;
  expectedSchema: number;
  attachmentCount: number;
  attachmentMissing: number;
  attachmentMismatched: number;
  orphanFiles: number;
  backupDirectory: string;
  backupCount: number;
  latestBackupAt: string | null;
  lastBackupError: string;
}
const formatBytes = (bytes: number) =>
  `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
const nextBackupAt = (frequency: string, last: string | null) => {
  if (frequency === 'off') return null;
  const interval = frequency === 'daily' ? 86_400 : 7 * 86_400;
  const base = last ? Number(last) : Math.floor(Date.now() / 1000) - interval;
  return Number.isFinite(base) ? new Date((base + interval) * 1000) : null;
};
export function Settings({ store }: { store: RumoStore }) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [sectionQuery, setSectionQuery] = useState('');
  const [name, setName] = useState(store.data!.settings.name);
  const [dataInfo, setDataInfo] = useState<DataInfo | null>(null);
  const [frequency, setFrequency] = useState('off');
  const [dailyKeep, setDailyKeep] = useState(7);
  const [weeklyKeep, setWeeklyKeep] = useState(4);
  const [monthlyKeep, setMonthlyKeep] = useState(6);
  const [lastAutomatic, setLastAutomatic] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [hideValues, setHideValues] = useState(false);
  const [timelinePrivate, setTimelinePrivate] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [selected, setSelected] = useState<{
    path: string;
    manifest: BackupManifest;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const openData = () => setActiveSection('data');
    window.addEventListener('rumar-open-settings-data', openData);
    return () => window.removeEventListener('rumar-open-settings-data', openData);
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([
      invoke<DataInfo>('data_info'),
      getDatabase().then((db) =>
        db.select<
          {
            frequency: string;
            daily_keep: number;
            weekly_keep: number;
            monthly_keep: number;
            last_auto_at: string | null;
          }[]
        >(
          `SELECT frequency,daily_keep,weekly_keep,monthly_keep,last_auto_at
           FROM backup_preferences WHERE id=1`,
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
        setDailyKeep(rows[0]?.daily_keep ?? 7);
        setWeeklyKeep(rows[0]?.weekly_keep ?? 4);
        setMonthlyKeep(rows[0]?.monthly_keep ?? 6);
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
      const manifest = await invoke<BackupManifest>('inspect_backup', { source: path });
      setSelected({ path, manifest });
      setConfirmed(false);
      return 'Backup validado. Confira os dados abaixo antes de restaurar.';
    });
  }
  async function chooseBackupDirectory() {
    const path = await open({ multiple: false, directory: true });
    if (!path || typeof path !== 'string') return;
    await action(async () => {
      const automaticDirectory = await invoke<string>('set_backup_directory', {
        directory: path,
      });
      setDataInfo((current) => (current ? { ...current, automaticDirectory } : current));
      return 'Diretório de backups atualizado.';
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
    <div className="settings-page">
      <header className="page-header settings-header">
        <h1>Configurações</h1>
        <p>Encontre e ajuste as preferências do RUMAR.</p>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Seções de configurações">
          <label className="sr-only" htmlFor="settings-section-search">
            Buscar seção
          </label>
          <input
            id="settings-section-search"
            type="search"
            value={sectionQuery}
            onChange={(event) => setSectionQuery(event.target.value)}
            placeholder="Buscar seção…"
          />
          {sections
            .filter((section) =>
              section.label
                .toLocaleLowerCase('pt-BR')
                .includes(sectionQuery.toLocaleLowerCase('pt-BR')),
            )
            .map((section) => (
              <button
                key={section.id}
                type="button"
                aria-current={activeSection === section.id ? 'page' : undefined}
                onClick={() => setActiveSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          {sectionQuery &&
            !sections.some((section) =>
              section.label
                .toLocaleLowerCase('pt-BR')
                .includes(sectionQuery.toLocaleLowerCase('pt-BR')),
            ) && <p>Nenhuma seção encontrada.</p>}
        </nav>
        <div className="settings-content" aria-live="polite">
          {activeSection === 'general' && (
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
          )}
          {activeSection === 'appearance' && (
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
          )}
          {activeSection === 'general' && (
            <section className="settings-section">
              <h2>Preferências</h2>
              <div className="preference-row">
                <span>Primeiro dia da semana</span>
                <strong>Segunda-feira</strong>
              </div>
            </section>
          )}
          {activeSection === 'windows' && <WindowsSettings />}
          {activeSection === 'templates' && (
            <section className="settings-section">
              <h2>Templates</h2>
              <p>
                Reutilize estruturas de tarefas, projetos, rotinas, planos de treino e refeições.
              </p>
              <button
                className="secondary-button"
                aria-expanded={templatesOpen}
                onClick={() => setTemplatesOpen((current) => !current)}
              >
                {templatesOpen ? 'Fechar templates' : 'Abrir meus templates'}
              </button>
              {templatesOpen && <TemplatesGallery />}
            </section>
          )}
          {activeSection === 'notifications' && (
            <section className="settings-section">
              <h2>Notificações</h2>
              <NotificationSettings />
            </section>
          )}
          {activeSection === 'data' && (
            <section className="settings-section">
              <h2>Dados</h2>
              <DataCenter onImported={store.retry} />
              <p>O banco fica neste computador. Backups manuais são salvos onde você escolher.</p>
              {dataInfo && (
                <div className="settings-data-paths">
                  <p className="data-path">
                    <strong>Banco local:</strong> {dataInfo.databasePath}
                  </p>
                  <p className="data-path">
                    <strong>Backups automáticos:</strong> {dataInfo.automaticDirectory}
                  </p>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void chooseBackupDirectory()}
                    >
                      Alterar pasta
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await invoke('set_backup_directory', { directory: '' });
                          const info = await invoke<DataInfo>('data_info');
                          setDataInfo(info);
                          return 'Diretório padrão restaurado.';
                        })
                      }
                    >
                      Usar pasta padrão
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await invoke('open_backup_directory');
                          return 'Pasta de backups aberta.';
                        })
                      }
                    >
                      Abrir pasta
                    </button>
                  </div>
                </div>
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
                <div className="backup-retention-grid" aria-label="Retenção de backups">
                  <label htmlFor="backup-daily">
                    Diários
                    <input
                      id="backup-daily"
                      type="number"
                      min="1"
                      max="31"
                      value={dailyKeep}
                      disabled={busy}
                      onChange={(event) => setDailyKeep(Number(event.target.value))}
                    />
                  </label>
                  <label htmlFor="backup-weekly">
                    Semanais
                    <input
                      id="backup-weekly"
                      type="number"
                      min="1"
                      max="12"
                      value={weeklyKeep}
                      disabled={busy}
                      onChange={(event) => setWeeklyKeep(Number(event.target.value))}
                    />
                  </label>
                  <label htmlFor="backup-monthly">
                    Mensais
                    <input
                      id="backup-monthly"
                      type="number"
                      min="1"
                      max="24"
                      value={monthlyKeep}
                      disabled={busy}
                      onChange={(event) => setMonthlyKeep(Number(event.target.value))}
                    />
                  </label>
                </div>
                <button
                  className="secondary-button"
                  disabled={
                    busy ||
                    dailyKeep < 1 ||
                    dailyKeep > 31 ||
                    weeklyKeep < 1 ||
                    weeklyKeep > 12 ||
                    monthlyKeep < 1 ||
                    monthlyKeep > 24
                  }
                  onClick={() =>
                    void action(async () => {
                      const db = await getDatabase();
                      await db.execute(
                        `UPDATE backup_preferences SET frequency=$1,daily_keep=$2,
                         weekly_keep=$3,monthly_keep=$4 WHERE id=1`,
                        [frequency, dailyKeep, weeklyKeep, monthlyKeep],
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
              <p className="field-help">
                A retenção usa a data do manifest: {dailyKeep} diários, {weeklyKeep} semanais e{' '}
                {monthlyKeep} mensais. Backups manuais e pré-migration não são removidos.
              </p>
              <p>
                Último backup automático:{' '}
                {lastAutomatic
                  ? new Date(Number(lastAutomatic) * 1000).toLocaleString('pt-BR')
                  : 'ainda não criado'}
              </p>
              <p>
                Próximo backup:{' '}
                {frequency === 'off'
                  ? 'desativado'
                  : (nextBackupAt(frequency, lastAutomatic)?.toLocaleString('pt-BR') ??
                    'quando o RUMAR estiver disponível')}
              </p>
              <div className="name-field">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void manualBackup()}
                >
                  Criar backup agora
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void chooseRestore()}
                >
                  Restaurar backup
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const report = await invoke<HealthReport>('health_check');
                      setHealth(report);
                      return 'Verificação de integridade concluída.';
                    })
                  }
                >
                  Verificar integridade
                </button>
              </div>
              {health && (
                <div className="settings-health" role="status">
                  <h3>Estado dos dados</h3>
                  <p>
                    SQLite: {health.sqlite} · Chaves estrangeiras: {health.foreignKeys} · Schema{' '}
                    {health.schemaVersion}/{health.expectedSchema}
                  </p>
                  <p>
                    Anexos:{' '}
                    {health.attachmentCount -
                      health.attachmentMissing -
                      health.attachmentMismatched}
                    /{health.attachmentCount} íntegros · {health.orphanFiles} sem vínculo
                  </p>
                  <p>
                    Backups encontrados: {health.backupCount}
                    {health.latestBackupAt
                      ? ` · último em ${new Date(Number(health.latestBackupAt) * 1000).toLocaleString('pt-BR')}`
                      : ''}
                  </p>
                  {health.lastBackupError && (
                    <p className="dialog-error">Última falha de backup: {health.lastBackupError}</p>
                  )}
                </div>
              )}
              {selected && (
                <div className="settings-restore">
                  <p>
                    <strong>Backup selecionado:</strong> {selected.path}
                  </p>
                  <p>
                    RUMAR {selected.manifest.appVersion} · schema {selected.manifest.schemaVersion}{' '}
                    · criado em{' '}
                    {new Date(Number(selected.manifest.createdAt) * 1000).toLocaleString('pt-BR')}
                  </p>
                  <p>
                    Banco: {formatBytes(selected.manifest.databaseSize)} · anexos:{' '}
                    {selected.manifest.attachmentCount} · checksums e integridade validados
                  </p>
                  <p>
                    Restaurar substituirá os dados atuais. O RUMAR criará antes um backup
                    preventivo.
                  </p>
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
              <Trash store={store} />
            </section>
          )}
          {activeSection === 'privacy' && (
            <section className="settings-section">
              <h2>Privacidade</h2>
              <p>
                O RUMAR guarda seus dados localmente. Se você ativar Google Agenda, somente os
                eventos escolhidos serão enviados ao Google como espelho. Os backups contêm seus
                dados pessoais; guarde-os em local seguro.
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
          )}
          {activeSection === 'planning' && <PlannerSettings />}
          {activeSection === 'automations' && <AutomationsSettings />}
          {activeSection === 'integrations' && (
            <section className="settings-section">
              <h2>Integrações</h2>
              <GoogleCalendarSettings />
            </section>
          )}
          {activeSection === 'about' && (
            <section className="settings-section about">
              <img
                className="settings-about-mark"
                src="/assets/rumar/brand/mountain-mark.png"
                alt=""
                aria-hidden="true"
                loading="lazy"
              />
              <h2>
                RUMAR <span>{dataInfo?.appVersion ?? '1.8.0'}</span>
              </h2>
              <p>Clareza para o seu dia.</p>
              <p>
                Seus dados ficam neste computador. A integração com Google Agenda é opcional e
                unilateral. Sem telemetria.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
